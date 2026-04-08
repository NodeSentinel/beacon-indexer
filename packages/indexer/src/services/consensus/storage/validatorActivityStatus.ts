import { PrismaClient } from '@beacon-indexer/db';

/**
 * Owns the fast-path snapshot columns that reflect current validator activity.
 * Historical lifecycle fields remain outside this storage's responsibility.
 */
export class ValidatorActivityStatusStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async syncCurrentActivityStatus(params: {
    safeObservedSlot: number;
    inactiveMissedCount: number;
    maxAttestationDelay: number;
  }): Promise<void> {
    const { safeObservedSlot, inactiveMissedCount, maxAttestationDelay } = params;

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
