import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { PrismaClient } from '@beacon-indexer/db';

const INCIDENT_TRACKED_BEACON_STATUSES = [
  VALIDATOR_STATUS.pending_initialized,
  VALIDATOR_STATUS.pending_queued,
  VALIDATOR_STATUS.active_ongoing,
  VALIDATOR_STATUS.active_exiting,
  VALIDATOR_STATUS.active_slashed,
] as const;
// Cluster incidents only apply while validators are still expected to participate.
// Exited/withdrawn statuses are intentionally excluded.
export class IncidentStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async syncIncidents(params: {
    observedAt: Date;
    observedAtIso: string;
    observedSlot: number;
  }): Promise<void> {
    const { observedAt, observedAtIso, observedSlot } = params;

    // Missed reward columns remain NULL until we implement a non-overlapping
    // close-time aggregation strategy across raw, hourly, and daily sources.
    await this.prisma.$executeRaw`
      WITH
        -- Open incidents already persisted for each cluster.
        open_incidents AS (
          SELECT
            ci.id,
            ci.cluster_id,
            ci.opened_at,
            ci.opened_slot,
            ci.validator_indexes
          FROM cluster_incident ci
          WHERE ci.status = 'open'::"public"."ClusterIncidentStatus"
        ),

        -- Only validators currently marked inactive in snapshot and still in a tracked beacon status.
        -- A validator may belong to multiple clusters, so we keep the cluster relation here.
        inactive_cluster_validators AS (
          SELECT
            cv.cluster_id,
            vss.validator_index
          FROM validators_snapshot_stats vss
          JOIN cluster_validator cv ON cv.validator_index = vss.validator_index
          WHERE vss.is_inactive = true
            AND COALESCE(vss.beacon_status, 0) = ANY(${INCIDENT_TRACKED_BEACON_STATUSES}::int[])
        ),

        -- We only need to evaluate clusters that are currently affected by inactive validators
        -- or clusters that already have an open incident and may need to be updated/closed.
        target_clusters AS (
          SELECT cluster_id FROM open_incidents
          UNION
          SELECT DISTINCT cluster_id FROM inactive_cluster_validators
        ),

        -- Current incident state per relevant cluster derived from snapshot inactivity.
        cluster_states AS (
          SELECT
            c.id AS cluster_id,
            c.name AS cluster_name,
            c.owner_id,
            COALESCE(
              ARRAY_AGG(icv.validator_index ORDER BY icv.validator_index),
              ARRAY[]::int[]
            ) AS inactive_validator_indexes
          FROM target_clusters tc
          JOIN cluster c ON c.id = tc.cluster_id
          LEFT JOIN inactive_cluster_validators icv ON icv.cluster_id = c.id
          GROUP BY c.id, c.name, c.owner_id
        ),

        -- Open a new incident for clusters that currently have inactive validators
        -- and do not already have an open incident.
        inserted_open_incidents AS (
          INSERT INTO cluster_incident (
            cluster_id,
            status,
            opened_at,
            opened_slot,
            validator_indexes,
            opened_notification_queued_at,
            created_at,
            updated_at
          )
          SELECT
            cs.cluster_id,
            'open'::"public"."ClusterIncidentStatus",
            ${observedAt}::timestamp,
            ${observedSlot}::int,
            cs.inactive_validator_indexes,
            CASE
              WHEN u.telegram_id IS NOT NULL AND u.has_blocked_bot = false
              THEN ${observedAt}::timestamp
              ELSE NULL
            END,
            ${observedAt}::timestamp,
            ${observedAt}::timestamp
          FROM cluster_states cs
          LEFT JOIN open_incidents oi ON oi.cluster_id = cs.cluster_id
          JOIN "user" u ON u.id = cs.owner_id
          WHERE array_length(cs.inactive_validator_indexes, 1) > 0
            AND oi.id IS NULL
          ON CONFLICT DO NOTHING
          RETURNING id, cluster_id, validator_indexes, opened_notification_queued_at
        ),

        -- Enqueue notifications for newly opened incidents when the owner can receive bot messages.
        open_notifications AS (
          INSERT INTO notification_queue (
            id,
            user_id,
            type,
            payload,
            delivered,
            created_at
          )
          SELECT
            'ci_open_' || md5(ioi.id || random()::text || clock_timestamp()::text),
            c.owner_id,
            'incident_opened',
            jsonb_build_object(
              'clusterId', c.id,
              'clusterName', c.name,
              'incidentId', ioi.id,
              'openedAt', ${observedAtIso},
              'openedSlot', ${observedSlot}::int,
              'validatorIndexes', to_jsonb(ioi.validator_indexes)
            ),
            false,
            ${observedAt}::timestamp
          FROM inserted_open_incidents ioi
          JOIN cluster c ON c.id = ioi.cluster_id
          WHERE ioi.opened_notification_queued_at IS NOT NULL
        ),

        -- If an incident stays open and more validators become inactive, expand the
        -- stored validator set to the union of previously affected + currently inactive.
        updated_open_incidents AS (
          UPDATE cluster_incident ci
          SET
            validator_indexes = merged.validator_indexes,
            updated_at = ${observedAt}::timestamp
          FROM (
            SELECT
              oi.id,
              ARRAY(
                SELECT DISTINCT validator_index
                FROM unnest(oi.validator_indexes || cs.inactive_validator_indexes) AS validator_index
                ORDER BY validator_index
              ) AS validator_indexes
            FROM open_incidents oi
            JOIN cluster_states cs ON cs.cluster_id = oi.cluster_id
            WHERE array_length(cs.inactive_validator_indexes, 1) > 0
          ) merged
          WHERE ci.id = merged.id
            AND ci.validator_indexes IS DISTINCT FROM merged.validator_indexes
          RETURNING ci.id
        ),

        -- Close incidents whose cluster no longer has inactive validators.
        -- Duration is derived here from the observed slot/timestamp used by this sync tick.
        closed_incidents AS (
          UPDATE cluster_incident ci
          SET
            status = 'closed'::"public"."ClusterIncidentStatus",
            closed_at = ${observedAt}::timestamp,
            closed_slot = ${observedSlot}::int,
            duration_slots = GREATEST(${observedSlot}::int - ci.opened_slot, 0),
            duration_seconds = GREATEST(
              EXTRACT(EPOCH FROM (${observedAt}::timestamp - ci.opened_at))::int,
              0
            ),
            missed_consensus_rewards = NULL,
            missed_execution_rewards = NULL,
            closed_notification_queued_at = CASE
              WHEN u.telegram_id IS NOT NULL AND u.has_blocked_bot = false
              THEN ${observedAt}::timestamp
              ELSE NULL
            END,
            updated_at = ${observedAt}::timestamp
          FROM cluster_states cs
          JOIN cluster c ON c.id = cs.cluster_id
          JOIN "user" u ON u.id = c.owner_id
          WHERE ci.cluster_id = cs.cluster_id
            AND ci.status = 'open'::"public"."ClusterIncidentStatus"
            AND array_length(cs.inactive_validator_indexes, 1) IS NULL
          RETURNING
            ci.id,
            ci.cluster_id,
            ci.validator_indexes,
            ci.closed_at,
            ci.closed_slot,
            ci.duration_slots,
            ci.duration_seconds,
            ci.missed_consensus_rewards,
            ci.missed_execution_rewards,
            ci.closed_notification_queued_at
        ),

        -- Enqueue notifications for incidents that were closed in this sync tick.
        closed_notifications AS (
          INSERT INTO notification_queue (
            id,
            user_id,
            type,
            payload,
            delivered,
            created_at
          )
          SELECT
            'ci_close_' || md5(ci.id || random()::text || clock_timestamp()::text),
            c.owner_id,
            'incident_closed',
            jsonb_build_object(
              'clusterId', c.id,
              'clusterName', c.name,
              'incidentId', ci.id,
              'closedAt', ${observedAtIso},
              'closedSlot', ci.closed_slot,
              'durationSeconds', ci.duration_seconds,
              'durationSlots', ci.duration_slots,
              'missedConsensusRewards', CASE
                WHEN ci.missed_consensus_rewards IS NULL THEN NULL
                ELSE ci.missed_consensus_rewards::text
              END,
              'missedExecutionRewards', CASE
                WHEN ci.missed_execution_rewards IS NULL THEN NULL
                ELSE ci.missed_execution_rewards::text
              END,
              'validatorIndexes', to_jsonb(ci.validator_indexes)
            ),
            false,
            ${observedAt}::timestamp
          FROM closed_incidents ci
          JOIN cluster c ON c.id = ci.cluster_id
          WHERE ci.closed_notification_queued_at IS NOT NULL
        )

      -- Final no-op SELECT required so the write CTE chain can execute as one statement.
      SELECT 1
    `;
  }
}
