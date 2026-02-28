import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

/**
 * MonthlyArchiveStorage - Database persistence layer for monthly archive operations.
 *
 * Aggregates daily archive records into monthly records.
 * Follows the same pattern as WeeklyArchiveStorage.
 */
export class MonthlyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a monthly archive already exists for a specific UTC month.
   * Uses the master archive table.
   */
  async archiveExistsForMonth(timestamp: Date): Promise<boolean> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastMonth: true },
    });

    if (!archive?.lastMonth) {
      return false;
    }

    return archive.lastMonth >= timestamp;
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
   */
  async discoverDailyPartitionsForMonth(monthStart: Date, monthEnd: Date): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'validator_daily_archive'
      ORDER BY c.relname
    `;

    // Filter to partitions within the month range by parsing the YYYYMMDD suffix
    return result
      .map((r) => r.relname)
      .filter((name) => {
        const match = name.match(/validator_daily_archive_(\d{8})$/);
        if (!match) return false;
        const suffix = match[1];
        const year = parseInt(suffix.slice(0, 4), 10);
        const month = parseInt(suffix.slice(4, 6), 10) - 1;
        const day = parseInt(suffix.slice(6, 8), 10);
        const partitionDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        return partitionDate >= monthStart && partitionDate < monthEnd;
      });
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

        // 2. Aggregate daily data into monthly archive
        // Daily records already have discrete reward columns, so simple SUMs
        await tx.$executeRaw`
          INSERT INTO validator_monthly_archive (
            timestamp,
            validator_index,
            attestation_count,
            missed_attestation_count,
            head_reward,
            target_reward,
            source_reward,
            inactivity_penalty,
            missed_head_reward,
            missed_target_reward,
            missed_source_reward,
            sync_reward_total,
            exec_reward_total,
            block_reward_total
          )
          SELECT
            ${monthStart}::timestamp AS timestamp,
            validator_index,
            SUM(attestation_count)::int AS attestation_count,
            NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
            SUM(head_reward) AS head_reward,
            SUM(target_reward) AS target_reward,
            SUM(source_reward) AS source_reward,
            SUM(inactivity_penalty) AS inactivity_penalty,
            SUM(missed_head_reward) AS missed_head_reward,
            SUM(missed_target_reward) AS missed_target_reward,
            SUM(missed_source_reward) AS missed_source_reward,
            SUM(sync_reward_total) AS sync_reward_total,
            NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
            NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total
          FROM validator_daily_archive
          WHERE "timestamp" >= ${monthStart}::timestamp
            AND "timestamp" < ${nextMonthStart}::timestamp
          GROUP BY validator_index
        `;

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
