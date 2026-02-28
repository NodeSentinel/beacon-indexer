import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

/**
 * DailyArchiveStorage - Database persistence layer for daily archive operations.
 *
 * Aggregates hourly archive records into daily records.
 * Follows the same pattern as HourlyArchiveStorage.
 */
export class DailyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if a daily archive already exists for a specific UTC day.
   * Uses the master archive table.
   */
  async archiveExistsForDay(timestamp: Date): Promise<boolean> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastDay: true },
    });

    if (!archive?.lastDay) {
      return false;
    }

    return archive.lastDay >= timestamp;
  }

  /**
   * Get the last archived hour timestamp from the archive control table.
   */
  async getLastArchivedHour(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastHour: true },
    });

    return archive?.lastHour ?? null;
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
   * Discover hourly archive partition names for a given day range.
   */
  async discoverHourlyPartitionsForDay(dayStart: Date, dayEnd: Date): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'validator_hourly_archive'
      ORDER BY c.relname
    `;

    // Filter to partitions within the day range by parsing the YYYYMMDDHH suffix
    return result
      .map((r) => r.relname)
      .filter((name) => {
        const match = name.match(/validator_hourly_archive_(\d{10})$/);
        if (!match) return false;
        const suffix = match[1];
        const year = parseInt(suffix.slice(0, 4), 10);
        const month = parseInt(suffix.slice(4, 6), 10) - 1;
        const day = parseInt(suffix.slice(6, 8), 10);
        const hour = parseInt(suffix.slice(8, 10), 10);
        const partitionDate = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
        return partitionDate >= dayStart && partitionDate < dayEnd;
      });
  }

  /**
   * Execute daily archive atomically:
   * 1. Create daily archive partition
   * 2. Aggregate hourly data into daily record (extracting rewards from data_by_epoch JSONB)
   * 3. Drop hourly archive partitions for that day
   * 4. Update archive.lastDay
   */
  async archiveDayAtomically(
    dayStart: Date,
    hourlyPartitionNames: string[],
    dailyPartitionName: string,
  ): Promise<void> {
    const nextDayStart = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Create daily archive partition
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${dailyPartitionName}" PARTITION OF "validator_daily_archive" ` +
            `FOR VALUES FROM ('${dayStart.toISOString()}') TO ('${nextDayStart.toISOString()}')`,
        );

        // 2. Aggregate hourly data into daily archive
        // Extract individual reward components from data_by_epoch JSONB
        // data_by_epoch format: [[epoch, head, target, source, inactivity, mH, mT, mS, mI], ...]
        await tx.$executeRaw`
          WITH epoch_rewards_expanded AS (
            SELECT
              h.validator_index,
              (elem->>1)::bigint AS head,
              (elem->>2)::bigint AS target,
              (elem->>3)::bigint AS source,
              (elem->>4)::bigint AS inactivity,
              (elem->>5)::bigint AS missed_head,
              (elem->>6)::bigint AS missed_target,
              (elem->>7)::bigint AS missed_source
            FROM validator_hourly_archive h,
            jsonb_array_elements(h.data_by_epoch) AS elem
            WHERE h."timestamp" >= ${dayStart}::timestamp
              AND h."timestamp" < ${nextDayStart}::timestamp
          ),
          reward_agg AS (
            SELECT
              validator_index,
              SUM(head) AS head_reward,
              SUM(target) AS target_reward,
              SUM(source) AS source_reward,
              SUM(inactivity) AS inactivity_penalty,
              SUM(missed_head) AS missed_head_reward,
              SUM(missed_target) AS missed_target_reward,
              SUM(missed_source) AS missed_source_reward
            FROM epoch_rewards_expanded
            GROUP BY validator_index
          ),
          hourly_agg AS (
            SELECT
              validator_index,
              SUM(attestation_count)::int AS attestation_count,
              NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
              SUM(sync_reward_total) AS sync_reward_total,
              NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
              NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total
            FROM validator_hourly_archive
            WHERE "timestamp" >= ${dayStart}::timestamp
              AND "timestamp" < ${nextDayStart}::timestamp
            GROUP BY validator_index
          )
          INSERT INTO validator_daily_archive (
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
            ${dayStart}::timestamp AS timestamp,
            COALESCE(ha.validator_index, ra.validator_index) AS validator_index,
            COALESCE(ha.attestation_count, 0) AS attestation_count,
            ha.missed_attestation_count,
            COALESCE(ra.head_reward, 0) AS head_reward,
            COALESCE(ra.target_reward, 0) AS target_reward,
            COALESCE(ra.source_reward, 0) AS source_reward,
            COALESCE(ra.inactivity_penalty, 0) AS inactivity_penalty,
            COALESCE(ra.missed_head_reward, 0) AS missed_head_reward,
            COALESCE(ra.missed_target_reward, 0) AS missed_target_reward,
            COALESCE(ra.missed_source_reward, 0) AS missed_source_reward,
            COALESCE(ha.sync_reward_total, 0) AS sync_reward_total,
            ha.exec_reward_total,
            ha.block_reward_total
          FROM hourly_agg ha
          FULL OUTER JOIN reward_agg ra ON ha.validator_index = ra.validator_index
        `;

        // 3. Drop hourly archive partitions
        for (const partitionName of hourlyPartitionNames) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName}"`);
        }

        // 4. Update archive control table
        await tx.archive.update({
          where: { id: 1 },
          data: { lastDay: dayStart },
        });
      },
      {
        timeout: ms('10m'),
      },
    );
  }
}
