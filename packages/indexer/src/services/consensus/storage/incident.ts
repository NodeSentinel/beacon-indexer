import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { PrismaClient } from '@beacon-indexer/db';

import { getRuntimeChainConfig } from '@/src/lib/runtimeConfig.js';

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

  async syncIncidents(params: { observedAt: Date; observedSlot: number }): Promise<void> {
    const { observedAt, observedSlot } = params;
    const chainConfig = getRuntimeChainConfig();
    const genesisTimeSec = Math.floor(chainConfig.beacon.genesisTimestamp / 1000);
    const secPerSlot = Math.floor(chainConfig.beacon.slotDuration / 1000);
    const slotsPerEpoch = chainConfig.beacon.slotsPerEpoch;

    await this.prisma.$executeRaw`
      WITH
        -- Chain constants needed to translate slots into UTC hour/day buckets
        -- and epochs without recomputing them in many places.
        chain_constants AS (
          SELECT
            ${genesisTimeSec}::bigint AS genesis_sec,
            ${secPerSlot}::int AS sec_per_slot,
            ${slotsPerEpoch}::int AS slots_per_epoch
        ),

        -- Single-row archive boundary used to decide whether the incident start
        -- still lives in raw tables or already moved into archive tables.
        archive_hour_boundary AS (
          SELECT last_hour
          FROM archive
          WHERE id = 1
        ),

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
            vss.validator_index,
            vss.inactive_since_slot
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
            MIN(icv.inactive_since_slot) AS inactive_since_slot,
            COALESCE(
              ARRAY_AGG(icv.validator_index ORDER BY icv.validator_index) FILTER (
                WHERE icv.validator_index IS NOT NULL
              ),
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
            TO_TIMESTAMP(
              cc.genesis_sec +
              (COALESCE(cs.inactive_since_slot, ${observedSlot}::int)::bigint * cc.sec_per_slot)
            )::timestamp,
            COALESCE(cs.inactive_since_slot, ${observedSlot}::int),
            cs.inactive_validator_indexes,
            CASE
              WHEN u.telegram_id IS NOT NULL AND u.has_blocked_bot = false
              THEN ${observedAt}::timestamp
              ELSE NULL
            END,
            ${observedAt}::timestamp,
            ${observedAt}::timestamp
          FROM cluster_states cs
          CROSS JOIN chain_constants cc
          LEFT JOIN open_incidents oi ON oi.cluster_id = cs.cluster_id
          JOIN "user" u ON u.id = cs.owner_id
          WHERE array_length(cs.inactive_validator_indexes, 1) > 0
            AND oi.id IS NULL
          ON CONFLICT DO NOTHING
          RETURNING
            id,
            cluster_id,
            validator_indexes,
            opened_at,
            opened_slot,
            opened_notification_queued_at
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
              'openedAt', to_char(
                ioi.opened_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              ),
              'openedSlot', ioi.opened_slot,
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

        -- Incidents whose cluster no longer has inactive validators and must be closed.
        incident_closures AS (
          SELECT
            ci.id,
            ci.cluster_id,
            c.name AS cluster_name,
            c.owner_id,
            ci.validator_indexes,
            ci.opened_at,
            ci.opened_slot,
            TO_TIMESTAMP(
              cc.genesis_sec +
              (
                COALESCE(recovery.active_since_slot, ${observedSlot}::int)::bigint *
                cc.sec_per_slot
              )
            )::timestamp AS closed_at,
            COALESCE(recovery.active_since_slot, ${observedSlot}::int) AS closed_slot,
            GREATEST(COALESCE(recovery.active_since_slot, ${observedSlot}::int) - ci.opened_slot, 0)
              AS duration_slots,
            GREATEST(
              EXTRACT(EPOCH FROM (
                TO_TIMESTAMP(
                  cc.genesis_sec +
                  (
                    COALESCE(recovery.active_since_slot, ${observedSlot}::int)::bigint *
                    cc.sec_per_slot
                  )
                )::timestamp - ci.opened_at
              ))::int,
              0
            ) AS duration_seconds,
            CASE
              WHEN u.telegram_id IS NOT NULL AND u.has_blocked_bot = false
              THEN ${observedAt}::timestamp
              ELSE NULL
            END AS closed_notification_queued_at
          FROM cluster_incident ci
          JOIN cluster_states cs ON ci.cluster_id = cs.cluster_id
          JOIN cluster c ON c.id = cs.cluster_id
          JOIN "user" u ON u.id = c.owner_id
          CROSS JOIN chain_constants cc
          LEFT JOIN LATERAL (
            SELECT
              MAX(vss.active_since_slot)::int AS active_since_slot
            FROM unnest(ci.validator_indexes) AS affected_validator(validator_index)
            JOIN validators_snapshot_stats vss
              ON vss.validator_index = affected_validator.validator_index
          ) recovery ON true
          WHERE ci.status = 'open'::"public"."ClusterIncidentStatus"
            AND array_length(cs.inactive_validator_indexes, 1) IS NULL
        ),

        -- Precompute every time/slot/epoch boundary the reward calculation needs.
        -- Keeping this in one CTE makes the later sections much easier to read.
        closing_incident_time_bounds AS (
          SELECT
            ic.*,
            ai.last_hour,
            FLOOR(ic.opened_slot::numeric / c.slots_per_epoch)::int AS opened_epoch,
            FLOOR(ic.closed_slot::numeric / c.slots_per_epoch)::int AS closed_epoch,
            DATE_TRUNC(
              'hour',
              TO_TIMESTAMP(c.genesis_sec + (ic.opened_slot::bigint * c.sec_per_slot)) AT TIME ZONE 'UTC'
            )::timestamp AS opened_hour,
            DATE_TRUNC(
              'day',
              TO_TIMESTAMP(c.genesis_sec + (ic.opened_slot::bigint * c.sec_per_slot)) AT TIME ZONE 'UTC'
            )::timestamp AS opened_day,
            DATE_TRUNC('hour', ic.closed_at)::timestamp AS closed_hour,
            DATE_TRUNC('day', ic.closed_at)::timestamp AS closed_day
          FROM incident_closures ic
          CROSS JOIN chain_constants c
          CROSS JOIN archive_hour_boundary ai
        ),

        -- Decide whether we can compute an exact missed reward number.
        --
        -- Exact calculation is possible in two cases:
        -- 1. The incident opened after the latest archived hour, so everything is
        --    still in raw tables.
        -- 2. The incident touches archived data, but every archived day/hour we
        --    need still retains JSON detail (data_by_slot / data_by_epoch).
        --
        -- If a required daily row already had its JSON detail cleaned to NULL, we
        -- stop and store NULL instead of returning an imprecise approximation.
        closing_incident_calculation_eligibility AS (
          SELECT
            ib.id,
            CASE
              WHEN ib.last_hour IS NULL OR ib.opened_hour > ib.last_hour THEN true
              WHEN EXISTS (
                SELECT 1
                FROM validator_daily_archive vda
                WHERE vda.validator_index = ANY(ib.validator_indexes)
                  AND vda.timestamp BETWEEN ib.opened_day AND ib.closed_day
                  AND (vda.data_by_slot IS NULL OR vda.data_by_epoch IS NULL)
              ) THEN false
              -- If the incident start is archived, at least one archived boundary row
              -- with preserved JSON detail must exist so we can trim the partial day/hour.
              WHEN NOT EXISTS (
                SELECT 1
                FROM validator_hourly_archive vha
                WHERE vha.validator_index = ANY(ib.validator_indexes)
                  AND vha.timestamp = ib.opened_hour
                  AND vha.data_by_slot IS NOT NULL
                  AND vha.data_by_epoch IS NOT NULL
                UNION ALL
                SELECT 1
                FROM validator_daily_archive vda
                WHERE vda.validator_index = ANY(ib.validator_indexes)
                  AND vda.timestamp = ib.opened_day
                  AND vda.data_by_slot IS NOT NULL
                  AND vda.data_by_epoch IS NOT NULL
              ) THEN false
              ELSE true
            END AS can_calculate
          FROM closing_incident_time_bounds ib
        ),

        -- Portion still available in raw tables:
        -- epoch_rewards contains missed CL reward by epoch and validator_sync_rewards
        -- contains signed sync rewards by slot. Negative sync rows represent missed reward.
        live_unarchived_raw_rewards AS (
          SELECT
            ib.id,
            COALESCE((
              SELECT SUM(
                er.missed_head + er.missed_target + er.missed_source + er.missed_inactivity
              )::bigint
              FROM epoch_rewards er
              WHERE er.validator_index = ANY(ib.validator_indexes)
                AND er.epoch BETWEEN ib.opened_epoch AND ib.closed_epoch
            ), 0::bigint) AS cl_missed,
            COALESCE((
              SELECT SUM(-vsr.sync_committee)::bigint
              FROM validator_sync_rewards vsr
              WHERE vsr.validator_index = ANY(ib.validator_indexes)
                AND vsr.slot BETWEEN ib.opened_slot AND ib.closed_slot
                AND vsr.sync_committee < 0
            ), 0::bigint) AS sync_missed
          FROM closing_incident_time_bounds ib
        ),

        -- Whole daily archive rows fully covered by the incident.
        -- These rows can use aggregate columns directly because the incident spans
        -- the entire archived day, so no JSON trimming is needed.
        fully_covered_daily_archive_totals AS (
          SELECT
            ib.id,
            COALESCE(SUM(vda.cl_missed_reward_total), 0::bigint) AS cl_missed,
            COALESCE(SUM(vda.sync_missed_reward_total), 0::bigint) AS sync_missed
          FROM closing_incident_time_bounds ib
          JOIN validator_daily_archive vda
            -- ANY(validator_indexes) expands the incident's validator set without
            -- exploding it into a separate unnested CTE.
            ON vda.validator_index = ANY(ib.validator_indexes)
           AND vda.timestamp > ib.opened_day
           AND vda.timestamp < ib.closed_day
          GROUP BY ib.id
        ),

        -- Partial daily archive rows at the incident boundaries.
        -- We only inspect the opened and closed day because all days strictly inside
        -- the range were already handled by fully_covered_daily_archive_totals.
        boundary_daily_archive_detail_rewards AS (
          SELECT
            ib.id,
            COALESCE(SUM(sync_rewards.sync_missed), 0::bigint) AS sync_missed,
            COALESCE(SUM(epoch_rewards.cl_missed), 0::bigint) AS cl_missed
          FROM closing_incident_time_bounds ib
          JOIN validator_daily_archive vda
            ON vda.validator_index = ANY(ib.validator_indexes)
           AND vda.timestamp IN (ib.opened_day, ib.closed_day)
           AND vda.data_by_slot IS NOT NULL
           AND vda.data_by_epoch IS NOT NULL
          LEFT JOIN LATERAL (
            -- LATERAL lets us parse only the current row's JSON array and keep the
            -- surrounding join cardinality at one row per archive record.
            SELECT
              COALESCE(SUM(-((slot_item.value ->> 2)::bigint)), 0::bigint) AS sync_missed
            FROM jsonb_array_elements(vda.data_by_slot) AS slot_item(value)
            WHERE jsonb_array_length(slot_item.value) >= 3
              AND (slot_item.value ->> 0)::int BETWEEN ib.opened_slot AND ib.closed_slot
              AND (slot_item.value ->> 2)::bigint < 0
          ) sync_rewards ON true
          LEFT JOIN LATERAL (
            -- data_by_epoch stores missed CL reward split in positions 5..8.
            -- Here we only keep epochs that fall inside the incident window.
            SELECT
              COALESCE(SUM(
                (epoch_item.value ->> 5)::bigint +
                (epoch_item.value ->> 6)::bigint +
                (epoch_item.value ->> 7)::bigint +
                (epoch_item.value ->> 8)::bigint
              ), 0::bigint) AS cl_missed
            FROM jsonb_array_elements(vda.data_by_epoch) AS epoch_item(value)
            WHERE (epoch_item.value ->> 0)::int BETWEEN ib.opened_epoch AND ib.closed_epoch
          ) epoch_rewards ON true
          GROUP BY ib.id
        ),

        -- Whole hourly archive rows fully covered by the incident.
        -- Same idea as daily totals, but for the hours between the first and last
        -- partial archived hours.
        fully_covered_hourly_archive_totals AS (
          SELECT
            ib.id,
            COALESCE(SUM(vha.cl_missed_reward_total), 0::bigint) AS cl_missed,
            COALESCE(SUM(vha.sync_missed_reward_total), 0::bigint) AS sync_missed
          FROM closing_incident_time_bounds ib
          JOIN validator_hourly_archive vha
            ON vha.validator_index = ANY(ib.validator_indexes)
           AND vha.timestamp > ib.opened_hour
           AND vha.timestamp < ib.closed_hour
          GROUP BY ib.id
        ),

        -- Partial hourly archive rows at the incident boundaries.
        -- We only crack open data_by_slot / data_by_epoch for the first and last
        -- archived hour touched by the incident.
        boundary_hourly_archive_detail_rewards AS (
          SELECT
            ib.id,
            COALESCE(SUM(sync_rewards.sync_missed), 0::bigint) AS sync_missed,
            COALESCE(SUM(epoch_rewards.cl_missed), 0::bigint) AS cl_missed
          FROM closing_incident_time_bounds ib
          JOIN validator_hourly_archive vha
            ON vha.validator_index = ANY(ib.validator_indexes)
           AND vha.timestamp IN (ib.opened_hour, ib.closed_hour)
          LEFT JOIN LATERAL (
            -- Parse only the current hourly row's slot tuples and keep the missed
            -- sync entries whose slot falls inside the incident boundaries.
            SELECT
              COALESCE(SUM(-((slot_item.value ->> 2)::bigint)), 0::bigint) AS sync_missed
            FROM jsonb_array_elements(vha.data_by_slot) AS slot_item(value)
            WHERE jsonb_array_length(slot_item.value) >= 3
              AND (slot_item.value ->> 0)::int BETWEEN ib.opened_slot AND ib.closed_slot
              AND (slot_item.value ->> 2)::bigint < 0
          ) sync_rewards ON true
          LEFT JOIN LATERAL (
            -- Parse only the current hourly row's epoch tuples and sum the missed
            -- CL reward components for epochs inside the incident window.
            SELECT
              COALESCE(SUM(
                (epoch_item.value ->> 5)::bigint +
                (epoch_item.value ->> 6)::bigint +
                (epoch_item.value ->> 7)::bigint +
                (epoch_item.value ->> 8)::bigint
              ), 0::bigint) AS cl_missed
            FROM jsonb_array_elements(vha.data_by_epoch) AS epoch_item(value)
            WHERE (epoch_item.value ->> 0)::int BETWEEN ib.opened_epoch AND ib.closed_epoch
          ) epoch_rewards ON true
          GROUP BY ib.id
        ),

        -- Final exact missed consensus reward, assembled from:
        -- - live raw data still not archived
        -- - fully covered daily/hourly archive buckets
        -- - boundary daily/hourly archive rows that need JSON trimming
        --
        -- The sources are intentionally non-overlapping:
        -- raw handles unarchived data only, aggregate archive CTEs handle only full
        -- buckets, and boundary archive CTEs handle only the partial opened/closed
        -- day/hour rows.
        closing_incident_missed_consensus_rewards AS (
          SELECT
            ib.id,
            rf.can_calculate,
            CASE
              WHEN rf.can_calculate THEN
                COALESCE(live_raw.cl_missed, 0::bigint) +
                COALESCE(live_raw.sync_missed, 0::bigint) +
                COALESCE(full_days.cl_missed, 0::bigint) +
                COALESCE(full_days.sync_missed, 0::bigint) +
                COALESCE(boundary_days.cl_missed, 0::bigint) +
                COALESCE(boundary_days.sync_missed, 0::bigint) +
                COALESCE(full_hours.cl_missed, 0::bigint) +
                COALESCE(full_hours.sync_missed, 0::bigint) +
                COALESCE(boundary_hours.cl_missed, 0::bigint) +
                COALESCE(boundary_hours.sync_missed, 0::bigint)
              ELSE NULL
            END AS missed_consensus_rewards
          FROM closing_incident_time_bounds ib
          JOIN closing_incident_calculation_eligibility rf ON rf.id = ib.id
          LEFT JOIN live_unarchived_raw_rewards live_raw ON live_raw.id = ib.id
          LEFT JOIN fully_covered_daily_archive_totals full_days ON full_days.id = ib.id
          LEFT JOIN boundary_daily_archive_detail_rewards boundary_days ON boundary_days.id = ib.id
          LEFT JOIN fully_covered_hourly_archive_totals full_hours ON full_hours.id = ib.id
          LEFT JOIN boundary_hourly_archive_detail_rewards boundary_hours
            ON boundary_hours.id = ib.id
        ),

        -- Close incidents and persist the best-effort missed consensus rewards.
        -- Execution-side missed rewards are intentionally not stored because
        -- the ideal proposer payout is not derivable from our current data model.
        closed_incidents AS (
          UPDATE cluster_incident ci
          SET
            status = 'closed'::"public"."ClusterIncidentStatus",
            closed_at = ic.closed_at,
            closed_slot = ic.closed_slot,
            duration_slots = ic.duration_slots,
            duration_seconds = ic.duration_seconds,
            missed_consensus_rewards = ir.missed_consensus_rewards,
            closed_notification_queued_at = ic.closed_notification_queued_at,
            updated_at = ic.closed_at
          FROM incident_closures ic
          LEFT JOIN closing_incident_missed_consensus_rewards ir ON ir.id = ic.id
          WHERE ci.id = ic.id
          RETURNING
            ci.id,
            ci.cluster_id,
            ci.validator_indexes,
            ci.closed_at,
            ci.closed_slot,
            ci.duration_slots,
            ci.duration_seconds,
            ci.missed_consensus_rewards,
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
            ic.owner_id,
            'incident_closed',
            jsonb_build_object(
              'clusterId', ic.cluster_id,
              'clusterName', ic.cluster_name,
              'incidentId', ci.id,
              'closedAt', to_char(
                ci.closed_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              ),
              'closedSlot', ci.closed_slot,
              'durationSeconds', ci.duration_seconds,
              'durationSlots', ci.duration_slots,
              'missedConsensusRewards', CASE
                WHEN ci.missed_consensus_rewards IS NULL THEN NULL
                ELSE ci.missed_consensus_rewards::text
              END,
              'validatorIndexes', to_jsonb(ci.validator_indexes)
            ),
            false,
            ${observedAt}::timestamp
          FROM closed_incidents ci
          JOIN incident_closures ic ON ic.id = ci.id
          WHERE ci.closed_notification_queued_at IS NOT NULL
        )

      -- Final no-op SELECT required so the write CTE chain can execute as one statement.
      SELECT 1
    `;
  }
}
