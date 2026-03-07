import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * AnalyticsStorage - Database persistence layer for analytics queries
 * Uses raw SQL for aggregated missed attestation data
 */
export class AnalyticsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Get missed attestations from the snapshot table (1h data)
   * Reads pre-computed missed_attestation_slots_h arrays, unnests, and groups by epoch
   */
  async getMissedAttestationsFromSnapshot(
    validatorIndexes: number[],
    slotsPerEpoch: number,
  ): Promise<Array<{ epoch: number; count: bigint; validator_count: bigint }>> {
    if (validatorIndexes.length === 0) {
      return [];
    }

    // slotsPerEpoch must be a literal (not a $N parameter) because PostgreSQL
    // requires GROUP BY expressions to match SELECT expressions exactly.
    return this.prisma.$queryRawUnsafe<
      Array<{ epoch: number; count: bigint; validator_count: bigint }>
    >(
      `SELECT
        (s.slot / ${slotsPerEpoch})::int AS epoch,
        COUNT(*)::bigint AS count,
        COUNT(DISTINCT vss.validator_index)::bigint AS validator_count
      FROM validators_snapshot_stats vss
      CROSS JOIN LATERAL unnest(vss.missed_attestation_slots_h) AS s(slot)
      WHERE vss.validator_index = ANY($1::int[])
      GROUP BY (s.slot / ${slotsPerEpoch})
      ORDER BY epoch ASC`,
      validatorIndexes,
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
        COALESCE(SUM(vha.missed_attestation_count), 0)::bigint AS count,
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
