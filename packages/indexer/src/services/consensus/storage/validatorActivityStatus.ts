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
      current_activity AS (
        SELECT
          vss.validator_index,
          COUNT(*) FILTER (
            WHERE rc.slot IS NOT NULL
              AND (rc.attestation_delay IS NULL OR rc.attestation_delay > ${maxAttestationDelay}::int)
          )::int AS missed_count,
          MAX(rc.slot)::int AS last_observed_slot,
          MAX(rc.slot) FILTER (
            WHERE rc.attestation_delay IS NOT NULL
              AND rc.attestation_delay <= ${maxAttestationDelay}::int
          )::int AS last_attested_slot,
          MAX(rc.slot) FILTER (
            WHERE rc.slot IS NOT NULL
              AND (rc.attestation_delay IS NULL OR rc.attestation_delay > ${maxAttestationDelay}::int)
          )::int AS last_missed_attestation_slot
        FROM validators_snapshot_stats vss
        LEFT JOIN recent_committees rc ON rc.validator_index = vss.validator_index
        GROUP BY vss.validator_index
      )
      UPDATE validators_snapshot_stats vss
      SET
        status = CASE
          WHEN ca.missed_count >= ${inactiveMissedCount}::int THEN 'inactive'
          ELSE 'active'
        END,
        is_inactive = ca.missed_count >= ${inactiveMissedCount}::int,
        consecutive_missed_attestations = ca.missed_count,
        last_observed_slot = ca.last_observed_slot,
        last_attested_slot = ca.last_attested_slot,
        last_missed_attestation_slot = ca.last_missed_attestation_slot,
        updated_at = NOW()
      FROM current_activity ca
      WHERE vss.validator_index = ca.validator_index
    `;
  }
}
