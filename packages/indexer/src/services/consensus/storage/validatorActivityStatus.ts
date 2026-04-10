import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { getActivityLookbackSlots } from './activityLookback.js';

type SyncCurrentActivityStatusParams = {
  // We only judge validator activity on slots that are already "safe enough":
  // if an attestation could still arrive later and be considered valid, that
  // slot must wait for a future run.
  safeObservedSlot: number;
  // A validator becomes currently inactive only after missing this many duties
  // in a row inside the rolling activity window.
  inactiveMissedCount: number;
  // Duties included later than this threshold are treated as misses for the
  // purpose of the current activity streak.
  maxAttestationDelay: number;
};

const VALIDATOR_ACTIVITY_PROCESSOR = 'validator-activity-status';
type IncidentTiming = {
  genesisTimeSec: number;
  secPerSlot: number;
};

/**
 * This storage pass is the bridge between raw attestation outcomes and the two
 * user-facing consequences we care about:
 * 1. keep each validator's "current activity" snapshot up to date, and
 * 2. open or close cluster incidents when registered validators cross the
 *    active/inactive boundary.
 *
 * The core scaling rule is that we now process one safe slot at a time. The
 * snapshot stores just enough streak state to continue incrementally, so each
 * run only needs the duties of the current slot instead of a large historical
 * committee window.
 */
export class ValidatorActivityStatusStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly incidentTiming: IncidentTiming,
    private readonly slotsPerEpoch: number,
  ) {}

  private getSqlTimestampForExpression(slotExpression: Prisma.Sql): Prisma.Sql {
    // Reproduce the same slot -> timestamp mapping the JS helpers use, but let
    // SQL provide the slot expression so set-based incident reconciliation can
    // derive opened/updated/closed timestamps per cluster row.
    return Prisma.sql`
      TIMESTAMP 'epoch' + (
        (${this.incidentTiming.genesisTimeSec}::bigint + (${slotExpression})::bigint * ${this.incidentTiming.secPerSlot}::bigint) *
        INTERVAL '1 second'
      )
    `;
  }

  async reconcileOpenIncidents(tx: Prisma.TransactionClient, params: { processedSlot: number }) {
    const processedSlot = Number(params.processedSlot);
    const processedSlotTimestamp = this.getSqlTimestampForExpression(
      Prisma.sql`${processedSlot}::int`,
    );

    // Compare two durable states only:
    // 1. the clusters that currently have registered validators marked inactive,
    // 2. the clusters that currently have an open incident.
    // From that diff SQL can insert missing incidents, widen the cumulative
    // validator set when new validators join the incident, and close incidents
    // only when no validators in the cluster remain inactive.
    await tx.$executeRaw`
      WITH current_inactive_clusters AS (
        -- Read only registered validators that are currently inactive and group
        -- them into one ordered validator list per cluster.
        SELECT
          cv.cluster_id,
          MIN(vss.inactive_since_slot) AS first_inactive_slot,
          array_agg(DISTINCT cv.validator_index ORDER BY cv.validator_index) AS inactive_validator_indexes
        FROM cluster_validator cv
        JOIN validators_snapshot_stats vss ON vss.validator_index = cv.validator_index
        WHERE vss.is_inactive = TRUE
          AND vss.inactive_since_slot IS NOT NULL
        GROUP BY cv.cluster_id
      ),
      open_incidents AS (
        -- Read the currently open incident per cluster so reconciliation can
        -- diff the persisted validator set against the current inactive set.
        SELECT
          id,
          cluster_id,
          opened_at,
          opened_slot,
          validator_indexes
        FROM cluster_incident
        WHERE status = 'open'
      ),
      recomputed AS (
        -- Join the live inactive set with the currently open incidents. Every
        -- touched cluster now has both its previous incident state and its live
        -- inactive membership in one row.
        SELECT
          COALESCE(current_inactive_clusters.cluster_id, open_incidents.cluster_id) AS cluster_id,
          open_incidents.id AS open_incident_id,
          open_incidents.opened_at AS current_opened_at,
          open_incidents.opened_slot AS current_opened_slot,
          COALESCE(open_incidents.validator_indexes, ARRAY[]::int[]) AS current_validator_indexes,
          current_inactive_clusters.first_inactive_slot,
          COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[]) AS current_inactive_validator_indexes,
          cardinality(
            COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[])
          ) AS current_inactive_count,
          ARRAY(
            SELECT DISTINCT validator_index
            FROM unnest(
              COALESCE(open_incidents.validator_indexes, ARRAY[]::int[]) ||
              COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[])
            ) AS validator_index
            ORDER BY validator_index
          ) AS next_validator_indexes
        FROM current_inactive_clusters
        FULL OUTER JOIN open_incidents
          ON open_incidents.cluster_id = current_inactive_clusters.cluster_id
      ),
      to_insert AS (
        -- If a cluster has inactive validators but no open incident, create one
        -- backdated to the earliest inactive validator in the cluster.
        SELECT
          ('incident-' || md5(cluster_id || ':' || first_inactive_slot::text || ':' || txid_current()::text)) AS incident_id,
          cluster_id,
          first_inactive_slot,
          next_validator_indexes
        FROM recomputed
        WHERE open_incident_id IS NULL
          AND first_inactive_slot IS NOT NULL
          AND cardinality(next_validator_indexes) > 0
      ),
      inserted_incidents AS (
        INSERT INTO cluster_incident (
          id,
          status,
          cluster_id,
          opened_at,
          opened_slot,
          validator_indexes,
          updated_at
        )
        SELECT
          to_insert.incident_id,
          'open'::"ClusterIncidentStatus",
          to_insert.cluster_id,
          ${this.getSqlTimestampForExpression(Prisma.sql`to_insert.first_inactive_slot`)},
          to_insert.first_inactive_slot,
          to_insert.next_validator_indexes,
          ${processedSlotTimestamp}
        FROM to_insert
        RETURNING id
      ),
      updated_incidents AS (
        -- Open incidents widen their stored validator set when new inactive
        -- validators join the same incident later.
        UPDATE cluster_incident AS incident
        SET
          validator_indexes = recomputed.next_validator_indexes,
          updated_at = ${processedSlotTimestamp}
        FROM recomputed
        WHERE incident.id = recomputed.open_incident_id
          AND recomputed.current_inactive_count > 0
          AND recomputed.next_validator_indexes <> recomputed.current_validator_indexes
        RETURNING incident.id
      ),
      closed_incidents AS (
        -- Any open incident whose cluster no longer has inactive validators
        -- closes on the slot we just processed.
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
        FROM recomputed
        WHERE incident.id = recomputed.open_incident_id
          AND recomputed.current_inactive_count = 0
        RETURNING incident.id
      )
      SELECT 1
    `;
  }

  private async updateSlotSnapshots(
    tx: Prisma.TransactionClient,
    slot: number,
    inactiveMissedCount: number,
    maxAttestationDelay: number,
  ): Promise<void> {
    // The whole validator snapshot transition for one slot is local to the
    // current duty row plus the compact rolling state already stored in the
    // snapshot table, so SQL can update the slot in one set-based pass.
    await tx.$executeRaw`
      -- 1. Read only the committee duties for the slot we are processing and
      --    enrich each one with the compact "before" snapshot state already
      --    stored on the validator row.
      WITH slot_duties AS (
        SELECT
          c.validator_index,
          c.slot,
          (c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int) AS duty_was_missed,
          vss.is_inactive AS starting_is_inactive,
          vss.active_since_slot AS starting_active_since_slot,
          vss.consecutive_missed_attestations AS starting_consecutive_missed_attestations,
          vss.missed_streak_started_at_slot AS starting_missed_streak_started_at_slot
        FROM committee c
        JOIN validators_snapshot_stats vss ON vss.validator_index = c.validator_index
        WHERE c.slot = ${slot}::int
      ),
      -- 2. Compute the complete "after" state for each touched validator.
      --    This is the pure transition function:
      --    current snapshot + current duty -> next snapshot.
      recomputed AS (
        SELECT
          validator_index,
          slot,
          duty_was_missed,
          starting_is_inactive,
          -- If the current duty was missed, the streak grows by one.
          -- Any successful duty resets the streak immediately.
          CASE
            WHEN duty_was_missed THEN starting_consecutive_missed_attestations + 1
            ELSE 0
          END AS next_consecutive_missed_attestations,
          -- The streak start is the first missed slot of the current missed run.
          -- A brand-new miss starts on this slot; otherwise we keep carrying
          -- forward the first missed slot that was already stored before.
          CASE
            WHEN duty_was_missed THEN
              CASE
                WHEN starting_consecutive_missed_attestations = 0 THEN slot
                ELSE COALESCE(starting_missed_streak_started_at_slot, slot)
              END
            ELSE NULL
          END AS next_missed_streak_started_at_slot,
          -- A validator stays inactive while it keeps missing, or becomes
          -- inactive exactly when the missed streak reaches the threshold.
          -- Any successful duty makes it active again immediately.
          CASE
            WHEN duty_was_missed THEN
              starting_is_inactive OR
              starting_consecutive_missed_attestations + 1 >= ${inactiveMissedCount}::int
            ELSE FALSE
          END AS next_is_inactive,
          -- active_since_slot only changes on recovery: the attested slot is
          -- the exact point where the validator became active again.
          CASE
            WHEN duty_was_missed THEN starting_active_since_slot
            ELSE slot
          END AS next_active_since_slot
        FROM slot_duties
      )
      -- 3. Persist the next snapshot in one UPDATE. Incident reconciliation runs
      --    afterwards by diffing the durable snapshot state against open incidents.
      UPDATE validators_snapshot_stats AS vss
      SET
        is_inactive = recomputed.next_is_inactive,
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

  async syncCurrentActivityStatus(params: SyncCurrentActivityStatusParams): Promise<void> {
    const { safeObservedSlot, inactiveMissedCount, maxAttestationDelay } = params;
    const lookbackSlots = getActivityLookbackSlots(this.slotsPerEpoch, inactiveMissedCount);

    await this.prisma.$transaction(async (tx) => {
      // The processor state is the durable bookmark for this whole pipeline.
      // On the first run we bootstrap only the recent lookback range; after that
      // every run continues incrementally from the last committed safe slot.
      const processorState = await tx.incidentProcessorState.upsert({
        where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
        update: {},
        create: {
          processor: VALIDATOR_ACTIVITY_PROCESSOR,
          lastProcessedSlot: Math.max(safeObservedSlot - lookbackSlots - 1, -1),
        },
      });

      const lowerExclusiveSlot = Math.max(
        processorState.lastProcessedSlot,
        safeObservedSlot - lookbackSlots - 1,
      );

      if (lowerExclusiveSlot >= safeObservedSlot) {
        return;
      }

      // Walk slot by slot through the safe boundary. This keeps the working set
      // bounded by one slot's committee instead of a large historical window.
      for (let slot = lowerExclusiveSlot + 1; slot <= safeObservedSlot; slot += 1) {
        await this.updateSlotSnapshots(tx, slot, inactiveMissedCount, maxAttestationDelay);
        // Incident reconciliation no longer receives derived deltas from JS.
        // After the snapshot update is durable for this slot, SQL compares the
        // current inactive registered validators against the currently open
        // incidents and opens, updates, or closes rows from that diff alone.
        await this.reconcileOpenIncidents(tx, {
          processedSlot: slot,
        });
      }

      // Only after snapshot rows and incident history are both settled do we
      // advance the durable bookmark to the newest safe slot.
      await tx.incidentProcessorState.update({
        where: { processor: VALIDATOR_ACTIVITY_PROCESSOR },
        data: { lastProcessedSlot: safeObservedSlot },
      });
    });
  }
}
