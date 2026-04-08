import { PrismaClient } from '@beacon-indexer/db';

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
  constructor(private readonly prisma: PrismaClient) {}

  async syncCurrentActivityStatus(params: SyncCurrentActivityStatusParams): Promise<void> {
    const { safeObservedSlot, inactiveMissedCount, maxAttestationDelay } = params;

    // Recompute the current missed-attestation streak from the recent committee
    // window only. This keeps the snapshot update cheap while still preserving
    // enough history to decide whether the validator is currently inactive.
    await this.prisma.$executeRaw`
      WITH recent_committees AS (
        SELECT
          c.validator_index,
          c.slot,
          c.attestation_delay
        FROM committee c
        WHERE c.slot <= ${safeObservedSlot}::int
          AND c.slot > ${safeObservedSlot}::int - (${inactiveMissedCount}::int * 40)
      ),
      ranked_committees AS (
        -- Rank duties newest-first so we can stop the streak at the first attested
        -- duty and count only the trailing misses that still matter "right now".
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
        -- Capture the newest successful attestation in the window so the next step
        -- can ignore misses that happened before the validator became active again.
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
        -- Project one row per snapshot validator with the size of its current missed
        -- streak and the last attested slot that is still visible in the window.
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
      -- Persist only the fast-moving activity fields owned by this storage.
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
