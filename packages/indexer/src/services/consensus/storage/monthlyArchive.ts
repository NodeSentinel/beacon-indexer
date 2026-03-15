import { PrismaClient } from '@beacon-indexer/db';
import { formatInTimeZone } from 'date-fns-tz';
import ms from 'ms';

/**
 * MonthlyArchiveStorage - Database persistence layer for monthly archive operations.
 *
 * Aggregates daily archive records into monthly records.
 * Follows the same pattern as DailyArchiveStorage.
 */
export class MonthlyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a monthly archive already exists for a specific UTC month.
   * Uses the master archive table.
   */
  async archiveExistsForMonth(timestamp: Date): Promise<boolean> {
    const lastMonth = await this.getLastArchivedMonth();
    if (!lastMonth) return false;
    return lastMonth >= timestamp;
  }

  /**
   * Get the last archived day timestamp from the archive control table.
   */
  async getLastArchivedDay(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastDay: true },
    });

    return archive?.lastDay ?? null;
  }

  /**
   * Get the last archived month timestamp from the archive control table.
   */
  async getLastArchivedMonth(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastMonth: true },
    });

    return archive?.lastMonth ?? null;
  }

  /**
   * Discover daily archive partition names for a given month range.
   * Finds all daily partitions whose day falls within [monthStart, monthEnd).
   */
  async discoverDailyPartitionsForMonth(monthStart: Date, monthEnd: Date): Promise<string[]> {
    const startName = `validator_daily_archive_${formatInTimeZone(monthStart, 'UTC', 'yyyyMMdd')}`;
    const endName = `validator_daily_archive_${formatInTimeZone(monthEnd, 'UTC', 'yyyyMMdd')}`;

    return this.listDailyPartitions({ from: startName, to: endName });
  }

  private async listDailyPartitions(opts?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<string[]> {
    const from = opts?.from ?? '';
    const to = opts?.to ?? '';
    const limit = opts?.limit ?? 0;

    const result = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'validator_daily_archive'
        AND (${from} = '' OR c.relname >= ${from})
        AND (${to} = '' OR c.relname < ${to})
      ORDER BY c.relname ASC
      LIMIT CASE WHEN ${limit} > 0 THEN ${limit} ELSE 2147483647 END
    `;

    return result.map((r) => r.relname);
  }

  /**
   * Execute monthly archive atomically:
   * 1. Create monthly archive partition
   * 2. Aggregate daily data into monthly record
   * 3. Drop daily archive partitions for that month
   * 4. Update archive.lastMonth
   */
  async archiveMonthAtomically(
    monthStart: Date,
    nextMonthStart: Date,
    dailyPartitionNames: string[],
    monthlyPartitionName: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Create monthly archive partition
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${monthlyPartitionName}" PARTITION OF "validator_monthly_archive" ` +
            `FOR VALUES FROM ('${monthStart.toISOString()}') TO ('${nextMonthStart.toISOString()}')`,
        );

        // 2. Get max validator index for batching (PK lookup, instant)
        const [{ max_idx }] = await tx.$queryRaw<[{ max_idx: number }]>`
          SELECT COALESCE(MAX(id), 0)::int AS max_idx FROM "validator"
        `;

        // 3. Aggregate daily data into monthly archive in batches
        // Uses string concatenation to merge JSON arrays (same optimization as daily archive)
        const BATCH_SIZE = 50000;
        for (let batchStart = 0; batchStart <= max_idx; batchStart += BATCH_SIZE) {
          const batchEnd = batchStart + BATCH_SIZE;

          await tx.$executeRaw`
            INSERT INTO validator_monthly_archive (
              timestamp,
              validator_index,
              data_by_slot,
              data_by_epoch,
              attestation_count,
              missed_attestation_count,
              sync_reward_total,
              exec_reward_total,
              block_reward_total,
              cl_reward_total,
              cl_missed_reward_total,
              avg_attestation_delay,
              attestation_efficiency
            )
            SELECT
              ${monthStart}::timestamp AS timestamp,
              validator_index,
              COALESCE(
                ('[' || string_agg(
                  CASE WHEN jsonb_array_length(data_by_slot) > 0
                    THEN substring(data_by_slot::text FROM 2 FOR length(data_by_slot::text) - 2)
                  END,
                  ',' ORDER BY "timestamp"
                ) || ']')::jsonb,
                '[]'::jsonb
              ) AS data_by_slot,
              COALESCE(
                ('[' || string_agg(
                  CASE WHEN jsonb_array_length(data_by_epoch) > 0
                    THEN substring(data_by_epoch::text FROM 2 FOR length(data_by_epoch::text) - 2)
                  END,
                  ',' ORDER BY "timestamp"
                ) || ']')::jsonb,
                '[]'::jsonb
              ) AS data_by_epoch,
              SUM(attestation_count)::smallint AS attestation_count,
              NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
              SUM(sync_reward_total) AS sync_reward_total,
              NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
              NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total,
              SUM(cl_reward_total) AS cl_reward_total,
              SUM(cl_missed_reward_total) AS cl_missed_reward_total,
              (SUM(avg_attestation_delay * attestation_count) / NULLIF(SUM(CASE WHEN avg_attestation_delay IS NOT NULL THEN attestation_count ELSE 0 END), 0))::real AS avg_attestation_delay,
              (SUM(attestation_efficiency * attestation_count) / NULLIF(SUM(CASE WHEN attestation_efficiency IS NOT NULL THEN attestation_count ELSE 0 END), 0))::real AS attestation_efficiency
            FROM validator_daily_archive
            WHERE "timestamp" >= ${monthStart}::timestamp
              AND "timestamp" < ${nextMonthStart}::timestamp
              AND validator_index >= ${batchStart}
              AND validator_index < ${batchEnd}
            GROUP BY validator_index
          `;
        }

        // 3. Drop daily archive partitions
        for (const partitionName of dailyPartitionNames) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName}"`);
        }

        // 4. Update archive control table
        await tx.archive.update({
          where: { id: 1 },
          data: { lastMonth: monthStart },
        });
      },
      {
        timeout: ms('10m'),
      },
    );
  }
}
