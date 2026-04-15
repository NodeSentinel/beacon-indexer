import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { getActivityLookbackSlots } from './activityLookback.js';

type SyncCurrentActivityStatusParams = {
  // Newest slot we can process in this run.
  newestProcessableSlot: number;
  // Missed duties in a row needed to mark a validator inactive.
  inactiveMissedCount: number;
  // Attestations later than this delay count as missed.
  maxAttestationDelay: number;
};

const VALIDATOR_ACTIVITY_PROCESSOR = 'validator-activity-status';
type IncidentTiming = {
  genesisTimeSec: number;
  secPerSlot: number;
};

/** Keeps validator activity snapshots and cluster incidents in sync. */
export class ValidatorActivityStatusStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly incidentTiming: IncidentTiming,
    private readonly slotsPerEpoch: number,
  ) {}

  /** Gets the SQL timestamp for a slot expression. */
  private getSqlTimestampForExpression(slotExpression: Prisma.Sql): Prisma.Sql {
    // Converts a slot expression into its chain timestamp inside SQL.
    return Prisma.sql`
      TIMESTAMP 'epoch' + (
        (${this.incidentTiming.genesisTimeSec}::bigint + (${slotExpression})::bigint * ${this.incidentTiming.secPerSlot}::bigint) *
        INTERVAL '1 second'
      )
    `;
  }

  /** Opens and closes incidents from the current inactive snapshot. */
  async reconcileOpenIncidents(tx: Prisma.TransactionClient, params: { processedSlot: number }) {
    const processedSlot = Number(params.processedSlot);
    const processedSlotTimestamp = this.getSqlTimestampForExpression(
      Prisma.sql`${processedSlot}::int`,
    );

    // Syncs open incidents with the current inactive snapshot.
    await tx.$executeRaw`
      WITH current_inactive_cluster_validators AS (
        -- Gets the validators that are inactive right now.
        SELECT
          cv.cluster_id,
          cv.validator_index,
          vss.inactive_since_slot
        FROM cluster_validator cv
        JOIN validators_snapshot_stats vss ON vss.validator_index = cv.validator_index
        WHERE vss.is_inactive = TRUE
          AND vss.inactive_since_slot IS NOT NULL
      ),
      current_inactive_clusters AS (
        -- Collapses inactive validators into one row per cluster.
        SELECT
          current_inactive_cluster_validators.cluster_id,
          MIN(current_inactive_cluster_validators.inactive_since_slot) AS first_inactive_slot,
          COUNT(*)::int AS current_inactive_count
        FROM current_inactive_cluster_validators
        GROUP BY current_inactive_cluster_validators.cluster_id
      ),
      open_incidents AS (
        -- Gets clusters that already have an open incident.
        SELECT
          id,
          cluster_id,
          opened_slot
        FROM cluster_incident
        WHERE status = 'open'
      ),
      recomputed_clusters AS (
        -- Gets one row per cluster with both current state and open incident state.
        SELECT
          COALESCE(current_inactive_clusters.cluster_id, open_incidents.cluster_id) AS cluster_id,
          open_incidents.id AS open_incident_id,
          current_inactive_clusters.first_inactive_slot,
          COALESCE(current_inactive_clusters.current_inactive_count, 0) AS current_inactive_count
        FROM current_inactive_clusters
        FULL OUTER JOIN open_incidents
          ON open_incidents.cluster_id = current_inactive_clusters.cluster_id
      ),
      to_insert AS (
        -- Opens incidents for clusters that just became inactive.
        SELECT
          gen_random_uuid() AS incident_id,
          cluster_id,
          first_inactive_slot
        FROM recomputed_clusters
        WHERE open_incident_id IS NULL
          AND first_inactive_slot IS NOT NULL
          AND current_inactive_count > 0
      ),
      inserted_incidents AS (
        INSERT INTO cluster_incident (
          id,
          status,
          cluster_id,
          opened_at,
          opened_slot,
          updated_at
        )
        SELECT
          to_insert.incident_id,
          'open'::"ClusterIncidentStatus",
          to_insert.cluster_id,
          ${this.getSqlTimestampForExpression(Prisma.sql`to_insert.first_inactive_slot`)},
          to_insert.first_inactive_slot,
          ${processedSlotTimestamp}
        FROM to_insert
        RETURNING id, cluster_id, opened_slot
      ),
      active_incidents AS (
        -- Puts new incidents and existing open incidents in one list.
        SELECT open_incidents.id, open_incidents.cluster_id, open_incidents.opened_slot
        FROM open_incidents
        UNION ALL
        SELECT inserted_incidents.id, inserted_incidents.cluster_id, inserted_incidents.opened_slot
        FROM inserted_incidents
      ),
      inserted_incident_validators AS (
        -- Opens missing validator rows for the incident.
        INSERT INTO cluster_incident_validator (
          id,
          incident_id,
          validator_index,
          inactive_from_slot,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          active_incidents.id,
          current_inactive_cluster_validators.validator_index,
          current_inactive_cluster_validators.inactive_since_slot,
          ${processedSlotTimestamp},
          ${processedSlotTimestamp}
        FROM active_incidents
        JOIN current_inactive_cluster_validators
          ON current_inactive_cluster_validators.cluster_id = active_incidents.cluster_id
        LEFT JOIN cluster_incident_validator
          ON cluster_incident_validator.incident_id = active_incidents.id
          AND cluster_incident_validator.validator_index =
            current_inactive_cluster_validators.validator_index
          AND cluster_incident_validator.inactive_to_slot IS NULL
        WHERE cluster_incident_validator.id IS NULL
        RETURNING id
      ),
      closed_incident_validators AS (
        -- Closes validator rows for validators that are no longer inactive.
        UPDATE cluster_incident_validator AS cluster_incident_validator
        SET
          inactive_to_slot = ${processedSlot}::int,
          updated_at = ${processedSlotTimestamp}
        FROM active_incidents
        WHERE cluster_incident_validator.incident_id = active_incidents.id
          AND cluster_incident_validator.inactive_to_slot IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM current_inactive_cluster_validators
            WHERE current_inactive_cluster_validators.cluster_id = active_incidents.cluster_id
              AND current_inactive_cluster_validators.validator_index =
                cluster_incident_validator.validator_index
          )
        RETURNING cluster_incident_validator.id
      ),
      closed_incidents AS (
        -- Closes incidents for clusters that no longer have inactive validators.
        UPDATE cluster_incident AS incident
        SET
          status = 'closed',
          closed_at = ${processedSlotTimestamp},
          closed_slot = ${processedSlot}::int,
          duration_slots = GREATEST(${processedSlot}::int - incident.opened_slot, 0),
          duration_seconds = GREATEST(
          FLOOR(EXTRACT(EPOCH FROM (${processedSlotTimestamp} - incident.opened_at)))::int,
            0
          ),
          updated_at = ${processedSlotTimestamp}
        FROM recomputed_clusters
        WHERE incident.id = recomputed_clusters.open_incident_id
          AND recomputed_clusters.current_inactive_count = 0
        RETURNING incident.id
      )
      SELECT 1
    `;
  }

  /** Updates validator activity snapshots for one slot. */
  private async updateSlotSnapshots(
    tx: Prisma.TransactionClient,
    slot: number,
    inactiveMissedCount: number,
    maxAttestationDelay: number,
  ): Promise<void> {
    // Recomputes the activity snapshot for validators that had duty in this slot.
    await tx.$executeRaw`
      -- Reads duties for this slot together with the current snapshot state.
      WITH slot_duties AS (
        SELECT
          c.validator_index,
          c.slot,
          -- Treats missing or late attestations as missed duties.
          (c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int) AS duty_was_missed,
          vss.is_inactive AS snapshot_is_inactive,
          vss.active_since_slot AS snapshot_active_since_slot,
          vss.consecutive_missed_attestations AS snapshot_consecutive_missed_attestations,
          vss.missed_streak_started_at_slot AS snapshot_missed_streak_started_at_slot
        FROM committee c
        JOIN validators_snapshot_stats vss ON vss.validator_index = c.validator_index
        WHERE c.slot = ${slot}::int
      ),
      -- Builds the next snapshot state for each touched validator.
      recomputed AS (
        SELECT
          validator_index,
          slot,
          duty_was_missed,
          snapshot_is_inactive,
          -- Miss grows the streak. Success resets it.
          CASE
            WHEN duty_was_missed THEN snapshot_consecutive_missed_attestations + 1
            ELSE 0
          END AS next_consecutive_missed_attestations,
          -- Keeps the first slot of the current missed streak.
          CASE
            WHEN duty_was_missed THEN
              CASE
                WHEN snapshot_consecutive_missed_attestations = 0 THEN slot
                ELSE COALESCE(snapshot_missed_streak_started_at_slot, slot)
              END
            ELSE NULL
          END AS next_missed_streak_started_at_slot,
          -- Validator becomes inactive when the streak reaches the threshold.
          CASE
            WHEN duty_was_missed THEN
              snapshot_is_inactive OR
              snapshot_consecutive_missed_attestations + 1 >= ${inactiveMissedCount}::int
            ELSE FALSE
          END AS next_is_inactive,
          -- Recovery sets the slot where the validator became active again.
          CASE
            WHEN duty_was_missed THEN snapshot_active_since_slot
            ELSE slot
          END AS next_active_since_slot
        FROM slot_duties
      )
      -- Writes the new snapshot state.
      UPDATE validators_snapshot_stats AS vss
      SET
        is_inactive = recomputed.next_is_inactive,
        -- Keeps the first missed slot while the validator stays inactive.
        inactive_since_slot = CASE
          WHEN recomputed.next_is_inactive THEN recomputed.next_missed_streak_started_at_slot
          ELSE NULL
        END,
        active_since_slot = recomputed.next_active_since_slot,
        consecutive_missed_attestations = recomputed.next_consecutive_missed_attestations,
        missed_streak_started_at_slot = recomputed.next_missed_streak_started_at_slot,
        updated_at = NOW()
      FROM recomputed
      WHERE vss.validator_index = recomputed.validator_index
    `;
  }

  /** Replays safe slots and keeps snapshots and incidents up to date. */
  async syncCurrentActivityStatus(params: SyncCurrentActivityStatusParams): Promise<void> {
    const { newestProcessableSlot, inactiveMissedCount, maxAttestationDelay } = params;

    // Gets how many slots we need to look back.
    const slotsToLookBack = getActivityLookbackSlots(this.slotsPerEpoch, inactiveMissedCount);

    // Gets the oldest slot we need to process in this run.
    const oldestProcessableSlot = newestProcessableSlot - slotsToLookBack;

    // Gets or creates the slot cursor for this processor.
    const processorState = await this.prisma.incidentProcessorState.upsert({
      where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
      update: {},
      create: {
        processor: VALIDATOR_ACTIVITY_PROCESSOR,
        lastProcessedSlot: Math.max(oldestProcessableSlot - 1, -1),
      },
    });

    // Gets the last slot we already covered
    const lastCoveredSlot = Math.max(processorState.lastProcessedSlot, oldestProcessableSlot - 1);

    // Stops here when there are no new safe slots left to replay.
    if (lastCoveredSlot >= newestProcessableSlot) {
      return;
    }

    // Processes one slot at a time up to the newest safe slot.
    for (let slot = lastCoveredSlot + 1; slot <= newestProcessableSlot; slot += 1) {
      await this.prisma.$transaction(async (tx) => {
        await this.updateSlotSnapshots(tx, slot, inactiveMissedCount, maxAttestationDelay);

        // Opens or closes incidents from the current snapshot state.
        await this.reconcileOpenIncidents(tx, {
          processedSlot: slot,
        });

        // Saves the slot cursor after this slot is done.
        await tx.incidentProcessorState.update({
          where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
          data: { lastProcessedSlot: slot },
        });
      });
    }
  }
}
