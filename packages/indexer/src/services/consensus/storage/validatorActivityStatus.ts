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
        await this.incidentStorage.reconcileOpenIncidents(tx, {
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
