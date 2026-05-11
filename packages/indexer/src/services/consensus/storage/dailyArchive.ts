import { Prisma, PrismaClient } from '@beacon-indexer/db';
import { addDays, subHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import ms from 'ms';

import { floorToUTCDay } from '@/src/utils/date/index.js';

const DAILY_MERGE_BATCH_SIZE = 5000;

/**
 * DailyArchiveStorage - Database persistence layer for daily archive operations.
 *
 * Aggregates hourly archive records into daily records.
 * Follows the same pattern as HourlyArchiveStorage.
 */
export class DailyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Read the newest raw-to-hourly archive boundary from the archive control row.
   */
  async getLastArchivedHour(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastHour: true },
    });

    return archive?.lastHour ?? null;
  }

  /**
   * Read the newest fully completed daily archive boundary.
   */
  async getLastArchivedDay(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastDay: true },
    });

    return archive?.lastDay ?? null;
  }

  /**
   * Return the oldest hourly partition that has already started merging.
   *
   * This keeps retries focused on unfinished work before the controller starts a
   * new source hour. The source partition must still exist because the merge
   * reads remaining validator batches from that partition.
   */
  async findPendingHourMergeProgress(): Promise<{
    hourStart: Date;
    dayStart: Date;
    partitionName: string;
  } | null> {
    const [progress] = await this.prisma.$queryRaw<
      Array<{ hour_start: Date; day_start: Date; source_partition: string }>
    >`
      SELECT progress.hour_start, progress.day_start, progress.source_partition
      FROM archive_hour_merge_progress progress
      JOIN pg_class c ON c.relname = progress.source_partition
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE progress.completed = false
        AND p.relname = 'validator_hourly_archive'
      ORDER BY progress.hour_start ASC
      LIMIT 1
    `;

    if (!progress) {
      return null;
    }

    return {
      hourStart: progress.hour_start,
      dayStart: progress.day_start,
      partitionName: progress.source_partition,
    };
  }

  /**
   * Return the exact hourly partition requested by the controller.
   *
   * The controller computes the next expected hour for the day. This method only
   * returns that exact partition when it is old enough to leave the 24-hour
   * hourly query window and has not already started merging.
   */
  async findExpectedHourlyPartitionToMerge(hourStart: Date): Promise<{
    hourStart: Date;
    dayStart: Date;
    partitionName: string;
  } | null> {
    const lastHour = await this.getLastArchivedHour();
    if (!lastHour) {
      return null;
    }

    const cutoffHour = subHours(lastHour, 24);
    if (hourStart > cutoffHour) {
      return null;
    }

    const partitionName = getHourlyArchivePartitionNameForDailyMerge(
      'validator_hourly_archive',
      hourStart,
    );

    const [partition] = await this.prisma.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      LEFT JOIN archive_hour_merge_progress progress
        ON progress.source_partition = c.relname
      WHERE p.relname = 'validator_hourly_archive'
        AND c.relname = ${partitionName}
        AND progress.hour_start IS NULL
      LIMIT 1
    `;

    if (!partition) {
      return null;
    }

    return {
      hourStart,
      dayStart: floorToUTCDay(hourStart),
      partitionName: partition.relname,
    };
  }

  /**
   * Count how many source hours have finished merging for one UTC day.
   */
  async countCompletedHoursForDay(dayStart: Date): Promise<number> {
    const [{ completed_hours }] = await this.prisma.$queryRaw<[{ completed_hours: number }]>`
      SELECT COUNT(*)::int AS completed_hours
      FROM archive_hour_merge_progress
      WHERE day_start = ${dayStart}::timestamp
        AND completed = true
    `;

    return completed_hours;
  }

  /**
   * Create the persistent batch cursor for one source hour.
   *
   * The cursor records the next validator index range to merge. If the process
   * restarts, the merge resumes from this row instead of starting over.
   */
  async ensureHourMergeProgress(input: {
    hourStart: Date;
    dayStart: Date;
    partitionName: string;
  }): Promise<void> {
    const [{ max_idx }] = await this.prisma.$queryRaw<[{ max_idx: number }]>`
      SELECT COALESCE(MAX(validator_index), 0)::int AS max_idx
      FROM validator_hourly_archive
      WHERE "timestamp" = ${input.hourStart}::timestamp
    `;

    await this.prisma.$executeRaw`
      INSERT INTO archive_hour_merge_progress (
        hour_start,
        day_start,
        source_partition,
        next_batch_start,
        max_validator,
        completed
      )
      VALUES (
        ${input.hourStart}::timestamp,
        ${input.dayStart}::timestamp,
        ${input.partitionName},
        0,
        ${max_idx},
        false
      )
      ON CONFLICT (hour_start) DO NOTHING
    `;
  }

  /**
   * Merge one validator-index range from an hourly partition into the daily row.
   *
   * The progress row is locked for the transaction so two workers cannot merge
   * the same range. Rows are staged in a detached WIP table so parent-table
   * reads cannot see a partial day. If this range completes the hour, the same
   * transaction drops the source hourly partition and publishes the WIP table
   * only when every expected hour for that day is complete.
   */
  async mergeNextHourBatch(
    hourStart: Date,
    expectedHourlyPartitions: number,
  ): Promise<{ hourStart: Date; completed: boolean }> {
    return await this.prisma.$transaction(
      async (tx) => {
        const [progress] = await tx.$queryRaw<
          Array<{
            hour_start: Date;
            day_start: Date;
            source_partition: string;
            next_batch_start: number;
            max_validator: number;
            completed: boolean;
          }>
        >`
          SELECT
            hour_start,
            day_start,
            source_partition,
            next_batch_start,
            max_validator,
            completed
          FROM archive_hour_merge_progress
          WHERE hour_start = ${hourStart}::timestamp
          FOR UPDATE
        `;

        if (!progress) {
          throw new Error(`Missing daily merge progress for hour ${hourStart.toISOString()}`);
        }

        const batchStart = progress.next_batch_start;
        const batchEnd = batchStart + DAILY_MERGE_BATCH_SIZE;
        const completed = batchEnd > progress.max_validator;
        const nextDayStart = addDays(progress.day_start, 1);
        const dailyWipPartitionName = getDailyArchiveWipPartitionNameForDailyMerge(
          progress.day_start,
        );

        await ensureDailyArchiveWipPartition(tx, progress.day_start);

        await tx.$executeRawUnsafe(`
          INSERT INTO "${dailyWipPartitionName}" (
            timestamp,
            validator_index,
            data_by_slot,
            data_by_epoch,
            attestation_count,
            missed_attestation_count,
            sync_reward_total,
            sync_missed_reward_total,
            exec_reward_total,
            block_reward_total,
            cl_reward_total,
            cl_missed_reward_total,
            avg_attestation_delay,
            attestation_efficiency
          )
          SELECT
            '${progress.day_start.toISOString()}'::timestamp AS timestamp,
            validator_index,
            data_by_slot,
            data_by_epoch,
            attestation_count,
            missed_attestation_count,
            sync_reward_total,
            sync_missed_reward_total,
            exec_reward_total,
            block_reward_total,
            cl_reward_total,
            cl_missed_reward_total,
            avg_attestation_delay,
            attestation_efficiency
          FROM validator_hourly_archive
          WHERE "timestamp" = '${progress.hour_start.toISOString()}'::timestamp
            AND validator_index >= ${batchStart}::int
            AND validator_index < ${batchEnd}::int
          ON CONFLICT (timestamp, validator_index) DO UPDATE SET
            data_by_slot = COALESCE("${dailyWipPartitionName}".data_by_slot, '[]'::jsonb) || EXCLUDED.data_by_slot,
            data_by_epoch = COALESCE("${dailyWipPartitionName}".data_by_epoch, '[]'::jsonb) || EXCLUDED.data_by_epoch,
            attestation_count = "${dailyWipPartitionName}".attestation_count + EXCLUDED.attestation_count,
            missed_attestation_count = NULLIF(
              COALESCE("${dailyWipPartitionName}".missed_attestation_count, 0) + COALESCE(EXCLUDED.missed_attestation_count, 0),
              0
            )::smallint,
            sync_reward_total = "${dailyWipPartitionName}".sync_reward_total + EXCLUDED.sync_reward_total,
            sync_missed_reward_total = "${dailyWipPartitionName}".sync_missed_reward_total + EXCLUDED.sync_missed_reward_total,
            exec_reward_total = NULLIF(
              COALESCE("${dailyWipPartitionName}".exec_reward_total, 0::numeric) + COALESCE(EXCLUDED.exec_reward_total, 0::numeric),
              0::numeric
            ),
            block_reward_total = NULLIF(
              COALESCE("${dailyWipPartitionName}".block_reward_total, 0::bigint) + COALESCE(EXCLUDED.block_reward_total, 0::bigint),
              0::bigint
            ),
            cl_reward_total = "${dailyWipPartitionName}".cl_reward_total + EXCLUDED.cl_reward_total,
            cl_missed_reward_total = "${dailyWipPartitionName}".cl_missed_reward_total + EXCLUDED.cl_missed_reward_total,
            avg_attestation_delay = (
              (
                COALESCE("${dailyWipPartitionName}".avg_attestation_delay * "${dailyWipPartitionName}".attestation_count, 0) +
                COALESCE(EXCLUDED.avg_attestation_delay * EXCLUDED.attestation_count, 0)
              ) / NULLIF(
                (CASE WHEN "${dailyWipPartitionName}".avg_attestation_delay IS NOT NULL THEN "${dailyWipPartitionName}".attestation_count ELSE 0 END) +
                (CASE WHEN EXCLUDED.avg_attestation_delay IS NOT NULL THEN EXCLUDED.attestation_count ELSE 0 END),
                0
              )
            )::real,
            attestation_efficiency = (
              (
                COALESCE("${dailyWipPartitionName}".attestation_efficiency * "${dailyWipPartitionName}".attestation_count, 0) +
                COALESCE(EXCLUDED.attestation_efficiency * EXCLUDED.attestation_count, 0)
              ) / NULLIF(
                (CASE WHEN "${dailyWipPartitionName}".attestation_efficiency IS NOT NULL THEN "${dailyWipPartitionName}".attestation_count ELSE 0 END) +
                (CASE WHEN EXCLUDED.attestation_efficiency IS NOT NULL THEN EXCLUDED.attestation_count ELSE 0 END),
                0
              )
            )::real
        `);

        await tx.$executeRaw`
          UPDATE archive_hour_merge_progress
          SET
            next_batch_start = ${batchEnd}::int,
            completed = ${completed},
            completed_at = CASE WHEN ${completed} THEN NOW() ELSE completed_at END,
            updated_at = NOW()
          WHERE hour_start = ${progress.hour_start}::timestamp
        `;

        if (completed) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${progress.source_partition}"`);

          const [{ completed_hours }] = await tx.$queryRaw<[{ completed_hours: number }]>`
            SELECT COUNT(*)::int AS completed_hours
            FROM archive_hour_merge_progress
            WHERE day_start = ${progress.day_start}::timestamp
              AND completed = true
          `;

          if (completed_hours === expectedHourlyPartitions) {
            await publishDailyArchiveWipPartition(tx, progress.day_start, nextDayStart);

            await tx.archive.update({
              where: { id: 1 },
              data: { lastDay: progress.day_start },
            });
          }

          const progressCleanupCutoff = subHours(progress.hour_start, 48);
          await tx.$executeRaw`
            DELETE FROM archive_hour_merge_progress
            WHERE completed = true
              AND hour_start < ${progressCleanupCutoff}::timestamp
          `;
        }

        return { hourStart: progress.hour_start, completed };
      },
      {
        timeout: ms('5m'),
      },
    );
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
}

/**
 * Generate a daily archive partition name inside the daily archive storage layer.
 */
function getDailyArchivePartitionNameForDailyMerge(
  tableNamePrefix: string,
  timestamp: Date,
): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}

/**
 * Generate the detached daily WIP table name used while a day is incomplete.
 */
function getDailyArchiveWipPartitionNameForDailyMerge(timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `validator_daily_archive_wip_${datetimeSuffix}`;
}

/**
 * Generate an hourly archive partition name inside the daily archive storage layer.
 */
function getHourlyArchivePartitionNameForDailyMerge(
  tableNamePrefix: string,
  timestamp: Date,
): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMddHH');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}

/**
 * Create the detached WIP table for one daily merge.
 *
 * The WIP table copies the parent defaults, constraints, and indexes, but it is
 * not attached to the partition parent until every source hour is complete.
 */
async function ensureDailyArchiveWipPartition(
  tx: Prisma.TransactionClient,
  dayStart: Date,
): Promise<void> {
  const nextDayStart = addDays(dayStart, 1);
  const wipPartitionName = getDailyArchiveWipPartitionNameForDailyMerge(dayStart);
  const rangeConstraintName = `${wipPartitionName}_timestamp_check`;

  // Create a standalone table so parent scans do not see partial daily rows.
  await tx.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${wipPartitionName}" ` +
      `(LIKE "validator_daily_archive" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
  );

  // Recreate the range check idempotently before attaching the completed table.
  await tx.$executeRawUnsafe(
    `ALTER TABLE "${wipPartitionName}" DROP CONSTRAINT IF EXISTS "${rangeConstraintName}"`,
  );

  // Constrain timestamps to the day so PostgreSQL can attach it as a partition.
  await tx.$executeRawUnsafe(
    `ALTER TABLE "${wipPartitionName}" ADD CONSTRAINT "${rangeConstraintName}" ` +
      `CHECK ("timestamp" >= '${dayStart.toISOString()}'::timestamp ` +
      `AND "timestamp" < '${nextDayStart.toISOString()}'::timestamp)`,
  );
}

/**
 * Rename the completed WIP table and attach it to the daily archive parent.
 */
async function publishDailyArchiveWipPartition(
  tx: Prisma.TransactionClient,
  dayStart: Date,
  nextDayStart: Date,
): Promise<void> {
  const wipPartitionName = getDailyArchiveWipPartitionNameForDailyMerge(dayStart);
  const dailyPartitionName = getDailyArchivePartitionNameForDailyMerge(
    'validator_daily_archive',
    dayStart,
  );

  // Rename first so the published table follows the normal partition name.
  await tx.$executeRawUnsafe(`ALTER TABLE "${wipPartitionName}" RENAME TO "${dailyPartitionName}"`);

  // Attach only after rename, making the completed day visible atomically.
  await tx.$executeRawUnsafe(
    `ALTER TABLE "validator_daily_archive" ATTACH PARTITION "${dailyPartitionName}" ` +
      `FOR VALUES FROM ('${dayStart.toISOString()}') TO ('${nextDayStart.toISOString()}')`,
  );
}
