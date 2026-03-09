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

        // 2. Aggregate daily data into monthly archive
        // Concatenate JSON arrays (unnest + re-aggregate) and sum aggregate columns
        await tx.$executeRaw`
          WITH daily_agg AS (
            SELECT
              validator_index,
              SUM(attestation_count)::smallint AS attestation_count,
              NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
              SUM(sync_reward_total) AS sync_reward_total,
              NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
              NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total,
              SUM(cl_reward_total) AS cl_reward_total,
              SUM(cl_missed_reward_total) AS cl_missed_reward_total,
              (SUM(avg_attestation_delay * attestation_count) / NULLIF(SUM(attestation_count), 0))::real AS avg_attestation_delay,
              (SUM(attestation_efficiency * attestation_count) / NULLIF(SUM(attestation_count), 0))::real AS attestation_efficiency
            FROM validator_daily_archive
            WHERE "timestamp" >= ${monthStart}::timestamp
              AND "timestamp" < ${nextMonthStart}::timestamp
            GROUP BY validator_index
          ),
          slot_json AS (
            SELECT
              d.validator_index,
              jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_slot
            FROM validator_daily_archive d,
            jsonb_array_elements(d.data_by_slot) AS elem
            WHERE d."timestamp" >= ${monthStart}::timestamp
              AND d."timestamp" < ${nextMonthStart}::timestamp
            GROUP BY d.validator_index
          ),
          epoch_json AS (
            SELECT
              d.validator_index,
              jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_epoch
            FROM validator_daily_archive d,
            jsonb_array_elements(d.data_by_epoch) AS elem
            WHERE d."timestamp" >= ${monthStart}::timestamp
              AND d."timestamp" < ${nextMonthStart}::timestamp
            GROUP BY d.validator_index
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
            cl_missed_reward_total,
            avg_attestation_delay,
            attestation_efficiency
          )
          SELECT
            ${monthStart}::timestamp AS timestamp,
            da.validator_index,
            COALESCE(sj.data_by_slot, '[]'::jsonb) AS data_by_slot,
            COALESCE(ej.data_by_epoch, '[]'::jsonb) AS data_by_epoch,
            COALESCE(da.attestation_count, 0::smallint) AS attestation_count,
            da.missed_attestation_count,
            COALESCE(da.sync_reward_total, 0) AS sync_reward_total,
            da.exec_reward_total,
            da.block_reward_total,
            COALESCE(da.cl_reward_total, 0) AS cl_reward_total,
            COALESCE(da.cl_missed_reward_total, 0) AS cl_missed_reward_total,
            da.avg_attestation_delay,
            da.attestation_efficiency
          FROM daily_agg da
          LEFT JOIN slot_json sj ON da.validator_index = sj.validator_index
          LEFT JOIN epoch_json ej ON da.validator_index = ej.validator_index
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
