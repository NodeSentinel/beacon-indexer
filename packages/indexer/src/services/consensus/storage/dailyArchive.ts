import { PrismaClient } from '@beacon-indexer/db';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
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
    const lastDay = await this.getLastArchivedDay();
    if (!lastDay) return false;
    return lastDay >= timestamp;
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
   * Filters directly in the database query using lexicographic partition name comparison.
   */
  async discoverHourlyPartitionsForDay(dayStart: Date, dayEnd: Date): Promise<string[]> {
    const startSuffix = formatInTimeZone(dayStart, 'UTC', 'yyyyMMddHH');
    const endSuffix = formatInTimeZone(dayEnd, 'UTC', 'yyyyMMddHH');
    return this.listHourlyPartitions({
      from: `validator_hourly_archive_${startSuffix}`,
      to: `validator_hourly_archive_${endSuffix}`,
    });
  }

  /**
   * List hourly archive partition names, optionally filtered by name range.
   */
  private async listHourlyPartitions(opts?: {
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
      WHERE p.relname = 'validator_hourly_archive'
        AND (${from} = '' OR c.relname >= ${from})
        AND (${to} = '' OR c.relname < ${to})
      ORDER BY c.relname ASC
      LIMIT CASE WHEN ${limit} > 0 THEN ${limit} ELSE 2147483647 END
    `;

    return result.map((r) => r.relname);
  }

  /**
   * Execute daily archive atomically:
   * 1. Create daily archive partition
   * 2. Aggregate hourly data into daily record (concat JSON arrays + sum aggregates)
   * 3. Drop hourly archive partitions for that day
   * 4. Update archive.lastDay
   */
  async archiveDayAtomically(
    dayStart: Date,
    hourlyPartitionNames: string[],
    dailyPartitionName: string,
  ): Promise<void> {
    const nextDayStart = addDays(dayStart, 1);

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Create daily archive partition
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${dailyPartitionName}" PARTITION OF "validator_daily_archive" ` +
            `FOR VALUES FROM ('${dayStart.toISOString()}') TO ('${nextDayStart.toISOString()}')`,
        );

        // 2. Get max validator index for batching (PK lookup, instant)
        const [{ max_idx }] = await tx.$queryRaw<[{ max_idx: number }]>`
          SELECT COALESCE(MAX(id), 0)::int AS max_idx FROM "validator"
        `;

        // 3. Aggregate hourly data into daily archive in batches
        // Process validators in chunks to avoid exceeding temp_file_limit
        const BATCH_SIZE = 10000;
        for (let batchStart = 0; batchStart <= max_idx; batchStart += BATCH_SIZE) {
          const batchEnd = batchStart + BATCH_SIZE;

          await tx.$executeRaw`
            WITH hourly_agg AS (
              SELECT
                validator_index,
                SUM(attestation_count)::smallint AS attestation_count,
                NULLIF(SUM(COALESCE(missed_attestation_count, 0)), 0)::smallint AS missed_attestation_count,
                SUM(sync_reward_total) AS sync_reward_total,
                NULLIF(SUM(COALESCE(exec_reward_total, 0::numeric)), 0::numeric) AS exec_reward_total,
                NULLIF(SUM(COALESCE(block_reward_total, 0::bigint)), 0::bigint) AS block_reward_total,
                SUM(cl_reward_total) AS cl_reward_total,
                SUM(cl_missed_reward_total) AS cl_missed_reward_total,
                (SUM(avg_attestation_delay * attestation_count) / NULLIF(SUM(CASE WHEN avg_attestation_delay IS NOT NULL THEN attestation_count ELSE 0 END), 0))::real AS avg_attestation_delay,
                (SUM(attestation_efficiency * attestation_count) / NULLIF(SUM(CASE WHEN attestation_efficiency IS NOT NULL THEN attestation_count ELSE 0 END), 0))::real AS attestation_efficiency
              FROM validator_hourly_archive
              WHERE "timestamp" >= ${dayStart}::timestamp
                AND "timestamp" < ${nextDayStart}::timestamp
                AND validator_index >= ${batchStart}
                AND validator_index < ${batchEnd}
              GROUP BY validator_index
            ),
            slot_json AS (
              SELECT
                h.validator_index,
                jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_slot
              FROM validator_hourly_archive h,
              jsonb_array_elements(h.data_by_slot) AS elem
              WHERE h."timestamp" >= ${dayStart}::timestamp
                AND h."timestamp" < ${nextDayStart}::timestamp
                AND h.validator_index >= ${batchStart}
                AND h.validator_index < ${batchEnd}
              GROUP BY h.validator_index
            ),
            epoch_json AS (
              SELECT
                h.validator_index,
                jsonb_agg(elem ORDER BY (elem->0)::int) AS data_by_epoch
              FROM validator_hourly_archive h,
              jsonb_array_elements(h.data_by_epoch) AS elem
              WHERE h."timestamp" >= ${dayStart}::timestamp
                AND h."timestamp" < ${nextDayStart}::timestamp
                AND h.validator_index >= ${batchStart}
                AND h.validator_index < ${batchEnd}
              GROUP BY h.validator_index
            )
            INSERT INTO validator_daily_archive (
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
              ${dayStart}::timestamp AS timestamp,
              ha.validator_index,
              COALESCE(sj.data_by_slot, '[]'::jsonb) AS data_by_slot,
              COALESCE(ej.data_by_epoch, '[]'::jsonb) AS data_by_epoch,
              COALESCE(ha.attestation_count, 0::smallint) AS attestation_count,
              ha.missed_attestation_count,
              COALESCE(ha.sync_reward_total, 0) AS sync_reward_total,
              ha.exec_reward_total,
              ha.block_reward_total,
              COALESCE(ha.cl_reward_total, 0) AS cl_reward_total,
              COALESCE(ha.cl_missed_reward_total, 0) AS cl_missed_reward_total,
              ha.avg_attestation_delay,
              ha.attestation_efficiency
            FROM hourly_agg ha
            LEFT JOIN slot_json sj ON ha.validator_index = sj.validator_index
            LEFT JOIN epoch_json ej ON ha.validator_index = ej.validator_index
          `;
        }

        // 4. Drop hourly archive partitions
        for (const partitionName of hourlyPartitionNames) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName}"`);
        }

        // 5. Update archive control table
        await tx.archive.update({
          where: { id: 1 },
          data: { lastDay: dayStart },
        });
      },
      {
        timeout: ms('15m'),
      },
    );
  }
}
