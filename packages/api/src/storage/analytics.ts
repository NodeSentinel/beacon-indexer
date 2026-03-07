import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * AnalyticsStorage - Database persistence layer for analytics queries
 * Uses raw SQL for aggregated missed attestation data
 */
export class AnalyticsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Get missed attestations from the committee table (recent data)
   * Groups by epoch and counts missed/delayed attestations
   */
  async getMissedAttestationsFromCommittee(
    validatorIndexes: number[],
    fromSlot: number,
    toSlot: number,
    slotsPerEpoch: number,
    maxAttestationDelay: number,
  ): Promise<Array<{ epoch: number; count: bigint; validator_count: bigint }>> {
    if (validatorIndexes.length === 0) {
      return [];
    }

    // slotsPerEpoch must be a literal (not a $N parameter) because PostgreSQL
    // requires GROUP BY expressions to match SELECT expressions exactly.
    // toSlot excludes recent slots still within the delaySlotsToHead window.
    return this.prisma.$queryRawUnsafe<
      Array<{ epoch: number; count: bigint; validator_count: bigint }>
    >(
      `SELECT
        (slot / ${slotsPerEpoch})::int AS epoch,
        COUNT(*)::bigint AS count,
        COUNT(DISTINCT validator_index)::bigint AS validator_count
      FROM committee
      WHERE validator_index = ANY($1::int[])
        AND slot >= $2
        AND slot <= $3
        AND (attestation_delay IS NULL OR attestation_delay > $4)
      GROUP BY (slot / ${slotsPerEpoch})
      ORDER BY epoch ASC`,
      validatorIndexes,
      fromSlot,
      toSlot,
      maxAttestationDelay,
    );
  }

  /**
   * Get missed attestations from the validator_hourly_archive table (historical data)
   * Groups by timestamp and sums missed attestation counts
   */
  async getMissedAttestationsFromArchive(
    validatorIndexes: number[],
    fromTimestamp: Date,
  ): Promise<Array<{ timestamp: Date; count: bigint; validator_count: bigint }>> {
    if (validatorIndexes.length === 0) {
      return [];
    }

    return this.prisma.$queryRaw<
      Array<{ timestamp: Date; count: bigint; validator_count: bigint }>
    >`
      SELECT
        vha.timestamp,
        SUM(vha.missed_attestation_count)::bigint AS count,
        COUNT(DISTINCT vha.validator_index)::bigint AS validator_count
      FROM validator_hourly_archive vha
      WHERE vha.validator_index = ANY(${validatorIndexes})
        AND vha.timestamp >= ${fromTimestamp}
        AND vha.missed_attestation_count > 0
      GROUP BY vha.timestamp
      ORDER BY vha.timestamp ASC
    `;
  }
}
