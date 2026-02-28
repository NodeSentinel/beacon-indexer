import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

/**
 * WeeklyArchiveStorage - Database persistence layer for weekly archive operations.
 *
 * Aggregates daily archive records into weekly records.
 * Follows the same pattern as DailyArchiveStorage.
 */
export class WeeklyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a weekly archive already exists for a specific UTC week.
   * Uses the master archive table.
   */
  async archiveExistsForWeek(timestamp: Date): Promise<boolean> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastWeek: true },
    });

    if (!archive?.lastWeek) {
      return false;
    }

    return archive.lastWeek >= timestamp;
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
   * Get the last archived week timestamp from the archive control table.
   */
  async getLastArchivedWeek(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastWeek: true },
    });

    return archive?.lastWeek ?? null;
  }

  /**
   * Discover daily archive partition names for a given week range.
   */
  async discoverDailyPartitionsForWeek(weekStart: Date, weekEnd: Date): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'validator_daily_archive'
      ORDER BY c.relname
    `;

    // Filter to partitions within the week range by parsing the YYYYMMDD suffix
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
        return partitionDate >= weekStart && partitionDate < weekEnd;
      });
  }

  /**
   * Execute weekly archive atomically:
   * 1. Create weekly archive partition
   * 2. Aggregate daily data into weekly record
   * 3. Drop daily archive partitions for that week
   * 4. Update archive.lastWeek
   */
  async archiveWeekAtomically(
    weekStart: Date,
    dailyPartitionNames: string[],
    weeklyPartitionName: string,
  ): Promise<void> {
    const nextWeekStart = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Create weekly archive partition
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${weeklyPartitionName}" PARTITION OF "validator_weekly_archive" ` +
            `FOR VALUES FROM ('${weekStart.toISOString()}') TO ('${nextWeekStart.toISOString()}')`,
        );

        // 2. Aggregate daily data into weekly archive
        // Daily records already have discrete reward columns, so simple SUMs
        await tx.$executeRaw`
          INSERT INTO validator_weekly_archive (
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
            ${weekStart}::timestamp AS timestamp,
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
          WHERE "timestamp" >= ${weekStart}::timestamp
            AND "timestamp" < ${nextWeekStart}::timestamp
          GROUP BY validator_index
        `;

        // 3. Drop daily archive partitions
        for (const partitionName of dailyPartitionNames) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName}"`);
        }

        // 4. Update archive control table
        await tx.archive.update({
          where: { id: 1 },
          data: { lastWeek: weekStart },
        });
      },
      {
        timeout: ms('10m'),
      },
    );
  }
}
