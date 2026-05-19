import { Prisma, PrismaClient } from '@beacon-indexer/db';
import { addDays, addHours, subHours } from 'date-fns';
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
   * Return the oldest daily merge that has an active source hour.
   *
   * This keeps retries focused on unfinished batch work before the controller
   * looks for a new eligible source hour.
   */
  async findPendingDailyMergeProgress(): Promise<{
    currentHour: Date;
    targetDay: Date;
    sourcePartition: string;
  } | null> {
    const progress = await this.prisma.archiveDailyMergeProgress.findFirst({
      where: {
        completed: false,
        sourcePartition: { not: null },
      },
      orderBy: { targetDay: 'asc' },
      select: {
        currentHour: true,
        targetDay: true,
        sourcePartition: true,
      },
    });

    if (!progress?.sourcePartition) {
      return null;
    }

    return {
      currentHour: progress.currentHour,
      targetDay: progress.targetDay,
      sourcePartition: progress.sourcePartition,
    };
  }

  /**
   * Return the daily merge cursor for a target day if one already exists.
   */
  async findDailyMergeProgress(targetDay: Date): Promise<{
    currentHour: Date;
    completed: boolean;
  } | null> {
    return await this.prisma.archiveDailyMergeProgress.findUnique({
      where: { targetDay },
      select: {
        currentHour: true,
        completed: true,
      },
    });
  }

  /**
   * Return the exact hourly partition requested by the controller.
   *
   * The controller computes the next expected hour for the day. This method only
   * returns that exact partition when it is old enough to leave the 24-hour
   * hourly query window and has not already started merging.
   */
  async findExpectedHourlyPartitionToMerge(hourStart: Date): Promise<{
    currentHour: Date;
    targetDay: Date;
    sourcePartition: string;
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
      LEFT JOIN archive_daily_merge_progress progress
        ON progress.source_partition = c.relname
      WHERE p.relname = 'validator_hourly_archive'
        AND c.relname = ${partitionName}
        AND progress.target_day IS NULL
      LIMIT 1
    `;

    if (!partition) {
      return null;
    }

    return {
      currentHour: hourStart,
      targetDay: floorToUTCDay(hourStart),
      sourcePartition: partition.relname,
    };
  }

  /**
   * Start or resume the persistent batch cursor for one target day.
   *
   * The cursor records the next validator index range to merge. If the process
   * restarts, the merge resumes from this row instead of starting over.
   */
  async startDailyMergeProgress(input: {
    currentHour: Date;
    targetDay: Date;
    sourcePartition: string;
  }): Promise<void> {
    const [{ max_idx }] = await this.prisma.$queryRaw<[{ max_idx: number }]>`
      SELECT COALESCE(MAX(validator_index), 0)::int AS max_idx
      FROM validator_hourly_archive
      WHERE "timestamp" = ${input.currentHour}::timestamp
    `;

    await this.prisma.$executeRaw`
      INSERT INTO archive_daily_merge_progress (
        target_day,
        current_hour,
        source_partition,
        next_batch_start,
        max_validator,
        completed
      )
      VALUES (
        ${input.targetDay}::timestamp,
        ${input.currentHour}::timestamp,
        ${input.sourcePartition},
        0,
        ${max_idx},
        false
      )
      ON CONFLICT (target_day) DO UPDATE SET
        current_hour = EXCLUDED.current_hour,
        source_partition = EXCLUDED.source_partition,
        next_batch_start = 0,
        max_validator = EXCLUDED.max_validator,
        updated_at = NOW()
      WHERE archive_daily_merge_progress.completed = false
        AND archive_daily_merge_progress.source_partition IS NULL
    `;
  }

  /**
   * Merge one validator-index range from an hourly partition into the daily row.
   *
   * The daily progress row is locked for the transaction so two workers cannot
   * merge the same range. Rows are staged in a detached WIP table so parent-table
   * reads cannot see a partial day.
   */
  async mergeNextHourBatch(targetDay: Date): Promise<{ hourStart: Date; completed: boolean }> {
    return await this.prisma.$transaction(
      async (tx) => {
        const [progress] = await tx.$queryRaw<
          Array<{
            target_day: Date;
            current_hour: Date;
            source_partition: string | null;
            next_batch_start: number;
            max_validator: number;
            completed: boolean;
          }>
        >`
          SELECT
            target_day,
            current_hour,
            source_partition,
            next_batch_start,
            max_validator,
            completed
          FROM archive_daily_merge_progress
          WHERE target_day = ${targetDay}::timestamp
          FOR UPDATE
        `;

        if (!progress) {
          throw new Error(`Missing daily merge progress for day ${targetDay.toISOString()}`);
        }

        // A worker can wait here while another worker completes this day.
        if (progress.completed) {
          return { hourStart: progress.current_hour, completed: true };
        }

        if (!progress.source_partition) {
          throw new Error(
            `Missing source partition for daily merge ${progress.target_day.toISOString()}`,
          );
        }

        const batchStart = progress.next_batch_start;
        const batchEnd = batchStart + DAILY_MERGE_BATCH_SIZE;
        const completed = batchEnd > progress.max_validator;
        const nextHour = addHours(progress.current_hour, 1);
        const nextDayStart = addDays(progress.target_day, 1);
        const completedDay = completed && nextHour >= nextDayStart;
        const dailyWipPartitionName = getDailyArchiveWipPartitionNameForDailyMerge(
          progress.target_day,
        );

        await ensureDailyArchiveWipPartition(tx, progress.target_day);

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
            '${progress.target_day.toISOString()}'::timestamp AS timestamp,
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
          WHERE "timestamp" = '${progress.current_hour.toISOString()}'::timestamp
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

        if (!completed) {
          await tx.$executeRaw`
            UPDATE archive_daily_merge_progress
            SET
              next_batch_start = ${batchEnd}::int,
              updated_at = NOW()
            WHERE target_day = ${progress.target_day}::timestamp
          `;
        }

        if (completed) {
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${progress.source_partition}"`);

          if (completedDay) {
            await publishDailyArchiveWipPartition(tx, progress.target_day, nextDayStart);

            await tx.archive.update({
              where: { id: 1 },
              data: { lastDay: progress.target_day },
            });

            await tx.$executeRaw`
              UPDATE archive_daily_merge_progress
              SET
                source_partition = NULL,
                next_batch_start = 0,
                max_validator = 0,
                completed = true,
                completed_at = NOW(),
                updated_at = NOW()
              WHERE target_day = ${progress.target_day}::timestamp
            `;
          } else {
            await tx.$executeRaw`
              UPDATE archive_daily_merge_progress
              SET
                current_hour = ${nextHour}::timestamp,
                source_partition = NULL,
                next_batch_start = 0,
                max_validator = 0,
                updated_at = NOW()
              WHERE target_day = ${progress.target_day}::timestamp
            `;
          }

          const progressCleanupCutoff = subHours(progress.current_hour, 48);
          await tx.$executeRaw`
            DELETE FROM archive_daily_merge_progress
            WHERE completed = true
              AND target_day < ${progressCleanupCutoff}::timestamp
          `;
        }

        return { hourStart: progress.current_hour, completed };
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

  const [wipPartition] = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.relname = ${wipPartitionName}
    ) AS exists
  `;

  // Reuse an existing WIP table so resumed batches do not revalidate WIP rows.
  if (wipPartition.exists) {
    return;
  }

  // Create a standalone table so parent scans do not see partial daily rows.
  await tx.$executeRawUnsafe(
    `CREATE TABLE "${wipPartitionName}" ` +
      `(LIKE "validator_daily_archive" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
  );

  // Add the range check only once, while the new WIP table is still empty.
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
