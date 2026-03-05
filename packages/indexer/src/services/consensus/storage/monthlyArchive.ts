import { PrismaClient } from '@beacon-indexer/db';
import { formatInTimeZone } from 'date-fns-tz';
import ms from 'ms';

/**
 * MonthlyArchiveStorage - Database persistence layer for monthly archive operations.
 *
 * Aggregates weekly archive records into monthly records.
 * Follows the same pattern as WeeklyArchiveStorage.
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
   * Get the oldest weekly archive partition timestamp.
   * Returns null if no weekly partitions exist.
   */
  async getOldestWeeklyPartition(): Promise<Date | null> {
    const partitions = await this.listWeeklyPartitions({ limit: 1 });
    if (partitions.length === 0) return null;

    // Format: validator_weekly_archive_YYYYwWW
    const match = partitions[0].match(/validator_weekly_archive_(\d{4})w(\d{2})$/);
    if (!match) return null;

    const year = parseInt(match[1], 10);
    const week = parseInt(match[2], 10);
    return isoWeekToDate(year, week);
  }

  /**
   * Discover weekly archive partition names for a given month range.
   * Finds all weekly partitions whose week start falls within [monthStart, monthEnd).
   */
  async discoverWeeklyPartitionsForMonth(monthStart: Date, monthEnd: Date): Promise<string[]> {
    // Weekly partitions use YYYYwWW format — lexicographic comparison works
    // because year+week naturally sorts correctly.
    // We need partitions whose week start >= monthStart and < monthEnd.
    // Since partition names encode the week start, we find the bounding week names.
    const startName = getWeeklyPartitionNameForDate('validator_weekly_archive', monthStart);
    const endName = getWeeklyPartitionNameForDate('validator_weekly_archive', monthEnd);

    return this.listWeeklyPartitions({
      from: startName,
      to: endName,
    });
  }

  private async listWeeklyPartitions(opts?: {
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
      WHERE p.relname = 'validator_weekly_archive'
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
   * 2. Aggregate weekly data into monthly record
   * 3. Drop weekly archive partitions for that month
   * 4. Update archive.lastMonth
   */
  async archiveMonthAtomically(
    monthStart: Date,
    nextMonthStart: Date,
    weeklyPartitionNames: string[],
    monthlyPartitionName: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Create monthly archive partition
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${monthlyPartitionName}" PARTITION OF "validator_monthly_archive" ` +
            `FOR VALUES FROM ('${monthStart.toISOString()}') TO ('${nextMonthStart.toISOString()}')`,
        );

        // 2. Aggregate weekly data into monthly archive
        // Concatenate JSON arrays (unnest + re-aggregate) and sum aggregate columns
        await tx.$executeRaw`
          WITH weekly_agg AS (
            SELECT
              validator_index,
              SUM(attestation_count)::smallint AS attestation_count,
              NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
              SUM(sync_reward_total) AS sync_reward_total,
              NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
              NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total,
              SUM(cl_reward_total) AS cl_reward_total,
              SUM(cl_missed_reward_total) AS cl_missed_reward_total
            FROM validator_weekly_archive
            WHERE "timestamp" >= ${monthStart}::timestamp
              AND "timestamp" < ${nextMonthStart}::timestamp
            GROUP BY validator_index
          ),
          slot_json AS (
            SELECT
              w.validator_index,
              jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_slot
            FROM validator_weekly_archive w,
            jsonb_array_elements(w.data_by_slot) AS elem
            WHERE w."timestamp" >= ${monthStart}::timestamp
              AND w."timestamp" < ${nextMonthStart}::timestamp
            GROUP BY w.validator_index
          ),
          epoch_json AS (
            SELECT
              w.validator_index,
              jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_epoch
            FROM validator_weekly_archive w,
            jsonb_array_elements(w.data_by_epoch) AS elem
            WHERE w."timestamp" >= ${monthStart}::timestamp
              AND w."timestamp" < ${nextMonthStart}::timestamp
            GROUP BY w.validator_index
          )
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
            cl_missed_reward_total
          )
          SELECT
            ${monthStart}::timestamp AS timestamp,
            wa.validator_index,
            COALESCE(sj.data_by_slot, '[]'::jsonb) AS data_by_slot,
            COALESCE(ej.data_by_epoch, '[]'::jsonb) AS data_by_epoch,
            COALESCE(wa.attestation_count, 0::smallint) AS attestation_count,
            wa.missed_attestation_count,
            COALESCE(wa.sync_reward_total, 0) AS sync_reward_total,
            wa.exec_reward_total,
            wa.block_reward_total,
            COALESCE(wa.cl_reward_total, 0) AS cl_reward_total,
            COALESCE(wa.cl_missed_reward_total, 0) AS cl_missed_reward_total
          FROM weekly_agg wa
          LEFT JOIN slot_json sj ON wa.validator_index = sj.validator_index
          LEFT JOIN epoch_json ej ON wa.validator_index = ej.validator_index
        `;

        // 3. Drop weekly archive partitions
        for (const partitionName of weeklyPartitionNames) {
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

/**
 * Convert ISO year + week number to the Monday Date of that week.
 */
function isoWeekToDate(year: number, week: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Convert Sunday=0 to 7
  const mondayOfWeek1 = new Date(jan4.getTime() - (dayOfWeek - 1) * 24 * 3600 * 1000);
  return new Date(mondayOfWeek1.getTime() + (week - 1) * 7 * 24 * 3600 * 1000);
}

/**
 * Get the weekly partition name that contains the given date.
 * Used for bounding partition discovery queries.
 */
function getWeeklyPartitionNameForDate(tableNamePrefix: string, date: Date): string {
  const year = formatInTimeZone(date, 'UTC', 'yyyy');
  const week = formatInTimeZone(date, 'UTC', 'II'); // ISO week number
  return `${tableNamePrefix}_${year}w${week}`;
}
