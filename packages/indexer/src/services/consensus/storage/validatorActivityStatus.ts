import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { getActivityLookbackSlots } from './activityLookback.js';
import { IncidentStorage } from './incident.js';

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

type SnapshotTransitionRow = {
  validator_index: number | bigint;
  is_inactive: boolean | null;
  transition_slot: number | bigint | null;
};

type ClusterTransitionBatchRow = {
  slot: number | bigint;
  cluster_id: string;
  additions: Array<number | bigint>;
  removals: Array<number | bigint>;
};

type ValidatorTransition = {
  validatorIndex: number;
  isInactive: boolean;
  transitionSlot: number;
};

const VALIDATOR_ACTIVITY_PROCESSOR = 'validator-activity-status';

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
    private readonly incidentStorage: IncidentStorage,
    private readonly slotsPerEpoch: number,
  ) {}

  private async updateSlotSnapshotsAndReturnTransitions(
    tx: Prisma.TransactionClient,
    slot: number,
    inactiveMissedCount: number,
    maxAttestationDelay: number,
  ): Promise<ValidatorTransition[]> {
    // The whole validator snapshot transition for one slot is local to the
    // current duty row plus the compact rolling state already stored in the
    // snapshot table, so SQL can update the slot in one set-based pass.
    const rows = await tx.$queryRaw<SnapshotTransitionRow[]>`
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
          vss.missed_streak_started_at_slot AS starting_missed_streak_started_at_slot,
          vss.last_attested_slot AS starting_last_attested_slot,
          vss.last_missed_attestation_slot AS starting_last_missed_attestation_slot
        FROM committee c
        JOIN validators_snapshot_stats vss ON vss.validator_index = c.validator_index
        WHERE c.slot = ${slot}::int
      ),
      -- 2. Compute the complete "after" state for each touched validator.
      --    This is the pure transition function:
      --    current snapshot + current duty -> next snapshot + optional transition.
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
          END AS next_active_since_slot,
          -- last_attested_slot keeps the most recent successful duty only while
          -- the validator is still currently active. Once the missed streak has
          -- crossed the inactivity threshold, the snapshot must expose that
          -- there is no fresh attestation in the current inactive run.
          CASE
            WHEN duty_was_missed
              AND (
                starting_is_inactive OR
                starting_consecutive_missed_attestations + 1 >= ${inactiveMissedCount}::int
              )
            THEN NULL
            WHEN duty_was_missed THEN starting_last_attested_slot
            ELSE slot
          END AS next_last_attested_slot,
          -- The "last missed" marker only moves forward on misses.
          CASE
            WHEN duty_was_missed THEN slot
            ELSE starting_last_missed_attestation_slot
          END AS next_last_missed_attestation_slot,
          -- We emit a transition only on the exact boundary crossing:
          -- active -> inactive when the threshold is first reached,
          -- inactive -> active on the first successful duty.
          -- TRUE means "opened inactivity", FALSE means "closed inactivity".
          CASE
            WHEN NOT starting_is_inactive
              AND duty_was_missed
              AND starting_consecutive_missed_attestations + 1 >= ${inactiveMissedCount}::int
            THEN TRUE
            WHEN starting_is_inactive AND NOT duty_was_missed
            THEN FALSE
            ELSE NULL
          END AS transition_is_inactive,
          -- Opening transitions point back to the first miss of the streak,
          -- not the slot where the threshold was detected. Closing transitions
          -- happen on the successful duty slot itself.
          CASE
            WHEN NOT starting_is_inactive
              AND duty_was_missed
              AND starting_consecutive_missed_attestations + 1 >= ${inactiveMissedCount}::int
            THEN
              CASE
                WHEN starting_consecutive_missed_attestations = 0 THEN slot
                ELSE COALESCE(starting_missed_streak_started_at_slot, slot)
              END
            WHEN starting_is_inactive AND NOT duty_was_missed
            THEN slot
            ELSE NULL
          END AS transition_slot
        FROM slot_duties
      ),
      -- 3. Persist the next snapshot in one UPDATE and keep only the validators
      --    that actually crossed the active/inactive boundary, because only
      --    those rows can affect cluster incidents.
      updated AS (
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
          last_attested_slot = recomputed.next_last_attested_slot,
          last_missed_attestation_slot = recomputed.next_last_missed_attestation_slot,
          updated_at = NOW()
        FROM recomputed
        WHERE vss.validator_index = recomputed.validator_index
        RETURNING
          recomputed.validator_index,
          recomputed.transition_is_inactive AS is_inactive,
          recomputed.transition_slot
      )
      SELECT
        validator_index,
        is_inactive,
        transition_slot
      FROM updated
      WHERE is_inactive IS NOT NULL AND transition_slot IS NOT NULL
      ORDER BY transition_slot ASC, validator_index ASC
    `;

    return rows.map((row) => ({
      validatorIndex: Number(row.validator_index),
      isInactive: row.is_inactive ?? false,
      transitionSlot: Number(row.transition_slot ?? slot),
    }));
  }

  private async loadClusterTransitionBatches(
    tx: Prisma.TransactionClient,
    transitions: ValidatorTransition[],
  ): Promise<Array<{ slot: number; clusterId: string; additions: number[]; removals: number[] }>> {
    if (transitions.length === 0) {
      return [];
    }

    const transitionValues = Prisma.join(
      transitions.map(
        (transition) => Prisma.sql`
        (
          ${transition.validatorIndex},
          ${transition.isInactive},
          ${transition.transitionSlot}
        )
      `,
      ),
    );

    // Once transitions are reduced to validator + direction + effective slot,
    // SQL can expand memberships and group them into one cluster delta per slot.
    const rows = await tx.$queryRaw<ClusterTransitionBatchRow[]>`
      -- 1. Materialize the validator transitions produced by the snapshot query
      --    as a tiny in-memory SQL table for this slot.
      WITH transitions(validator_index, is_inactive, transition_slot) AS (
        VALUES
          ${transitionValues}
      )
      -- 2. Expand each validator transition to every registered cluster that
      --    contains that validator, then collapse everything into one delta per
      --    cluster and effective transition slot.
      SELECT
        t.transition_slot AS slot,
        cv.cluster_id,
        COALESCE(array_agg(t.validator_index ORDER BY t.validator_index) FILTER (WHERE t.is_inactive), ARRAY[]::int[]) AS additions,
        COALESCE(array_agg(t.validator_index ORDER BY t.validator_index) FILTER (WHERE NOT t.is_inactive), ARRAY[]::int[]) AS removals
      FROM transitions t
      JOIN cluster_validator cv ON cv.validator_index = t.validator_index
      GROUP BY t.transition_slot, cv.cluster_id
      ORDER BY t.transition_slot ASC, cv.cluster_id ASC
    `;

    return rows.map((row) => ({
      slot: Number(row.slot),
      clusterId: row.cluster_id,
      additions: row.additions.map((validatorIndex) => Number(validatorIndex)),
      removals: row.removals.map((validatorIndex) => Number(validatorIndex)),
    }));
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
        const transitions = await this.updateSlotSnapshotsAndReturnTransitions(
          tx,
          slot,
          inactiveMissedCount,
          maxAttestationDelay,
        );
        const clusterTransitionBatches = await this.loadClusterTransitionBatches(tx, transitions);

        for (const batch of clusterTransitionBatches) {
          await this.incidentStorage.reconcileOpenIncident(tx, {
            clusterId: batch.clusterId,
            slot: batch.slot,
            additions: batch.additions,
            removals: batch.removals,
          });
        }
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
