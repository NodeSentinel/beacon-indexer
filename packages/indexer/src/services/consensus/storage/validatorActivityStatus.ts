import { PrismaClient } from '@beacon-indexer/db';

import { getActivityLookbackSlots } from './activityLookback.js';

type SyncCurrentActivityStatusParams = {
  // Last slot whose attestation outcome is old enough to be judged final for the
  // current activity snapshot. Newer slots may still receive valid inclusions.
  safeObservedSlot: number;
  // Minimum trailing missed-attestation streak required to mark a validator as
  // currently inactive in the fast snapshot.
  inactiveMissedCount: number;
  // Largest attestation delay still considered successful before a duty counts
  // as missed for the current activity streak.
  maxAttestationDelay: number;
};

/**
 * Owns the fast-path snapshot columns that reflect current validator activity.
 * Historical lifecycle fields remain outside this storage's responsibility.
 */
export class ValidatorActivityStatusStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly slotsPerEpoch: number,
  ) {}

  async syncCurrentActivityStatus(params: SyncCurrentActivityStatusParams): Promise<void> {
    const { safeObservedSlot, inactiveMissedCount, maxAttestationDelay } = params;
    const lookbackSlots = getActivityLookbackSlots(this.slotsPerEpoch, inactiveMissedCount);

    // Recompute the current missed-attestation streak from a bounded recent
    // committee window only. The window is long enough to include the last N
    // attestation opportunities for each validator, where N is the inactivity
    // threshold, plus a small boundary buffer for validators assigned near epoch
    // edges. Keeping the window bounded prevents scanning unnecessary history.
    await this.prisma.$executeRaw`
      WITH recent_committees AS (
        -- Step 1: load only the recent duties that are old enough to judge.
        -- This is the raw "attendance sheet" we care about for the current run.
        SELECT
          c.validator_index,
          c.slot,
          c.attestation_delay
        FROM committee c
        WHERE c.slot <= ${safeObservedSlot}::int
          AND c.slot > ${safeObservedSlot}::int - ${lookbackSlots}::int
      ),
      ranked_committees AS (
        -- Step 2: for each validator, order duties from newest to oldest and
        -- mark whether each duty counts as "missed" under the attestation-delay
        -- rule. duty_rank = 1 always means "this validator's newest duty".
        SELECT
          rc.validator_index,
          rc.slot,
          rc.attestation_delay,
          ROW_NUMBER() OVER (
            PARTITION BY rc.validator_index
            ORDER BY rc.slot DESC
          )::int AS duty_rank,
          (
            rc.attestation_delay IS NULL OR
            rc.attestation_delay > ${maxAttestationDelay}::int
          ) AS is_missed
        FROM recent_committees rc
      ),
      streak_bounds AS (
        -- Step 3: find the newest successful duty in the window for each
        -- validator. Once we know where the latest success is, we can ignore any
        -- older misses because they belong to a finished streak, not the current one.
        SELECT
          rc.validator_index,
          MIN(rc.duty_rank) FILTER (
            WHERE rc.is_missed = false
          )::int AS first_attested_rank,
          MAX(rc.slot) FILTER (
            WHERE rc.is_missed = false
          )::int AS last_attested_slot
        FROM ranked_committees rc
        GROUP BY rc.validator_index
      ),
      current_activity AS (
        -- Step 4: collapse the duty rows back down to one row per validator in
        -- the snapshot table. The filtered COUNT keeps only the trailing misses:
        -- misses newer than the latest success, or all misses if no success exists.
        --
        -- Starting from validators_snapshot_stats instead of committee preserves
        -- validators that had no duty in this recent window, so they still get a
        -- deterministic snapshot row in the final UPDATE.
        SELECT
          vss.validator_index,
          COUNT(*) FILTER (
            WHERE rc.is_missed = true
              AND (
                sb.first_attested_rank IS NULL OR
                rc.duty_rank < sb.first_attested_rank
              )
          )::int AS missed_streak,
          sb.last_attested_slot
        FROM validators_snapshot_stats vss
        LEFT JOIN ranked_committees rc ON rc.validator_index = vss.validator_index
        LEFT JOIN streak_bounds sb ON sb.validator_index = vss.validator_index
        GROUP BY vss.validator_index, sb.first_attested_rank, sb.last_attested_slot
      )
      -- Step 5: write the computed streak back into the snapshot table. This
      -- touches only the fast-moving activity columns owned by this storage.
      UPDATE validators_snapshot_stats vss
      SET
        is_inactive = ca.missed_streak >= ${inactiveMissedCount}::int,
        consecutive_missed_attestations = ca.missed_streak,
        last_attested_slot = ca.last_attested_slot,
        updated_at = NOW()
      FROM current_activity ca
      WHERE vss.validator_index = ca.validator_index
    `;
  }
}
