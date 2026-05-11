import { PrismaClient } from '@beacon-indexer/db';
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly archiveDetailRetentionDays: number,
  ) {}

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
   * Find the oldest hourly partition that is outside the 24-hour hourly query window.
   */
  async findOldestHourlyPartitionToMerge(): Promise<{
    hourStart: Date;
    dayStart: Date;
    partitionName: string;
  } | null> {
    const lastHour = await this.getLastArchivedHour();
    if (!lastHour) {
      return null;
    }

    const cutoffHour = subHours(lastHour, 24);
    const cutoffPartitionExclusive = getHourlyArchivePartitionNameForDailyMerge(
      'validator_hourly_archive',
      addHours(cutoffHour, 1),
    );

    const [partition] = await this.prisma.$queryRaw<Array<{ relname: string; hour_start: Date }>>`
      SELECT
        c.relname,
        to_timestamp(substring(c.relname FROM '([0-9]{10})$'), 'YYYYMMDDHH24')::timestamp AS hour_start
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      LEFT JOIN archive_hour_merge_progress progress
        ON progress.source_partition = c.relname
      WHERE p.relname = 'validator_hourly_archive'
        AND c.relname < ${cutoffPartitionExclusive}
        AND COALESCE(progress.completed, false) = false
      ORDER BY c.relname ASC
      LIMIT 1
    `;

    if (!partition) {
      return null;
    }

    return {
      hourStart: partition.hour_start,
      dayStart: floorToUTCDay(partition.hour_start),
      partitionName: partition.relname,
    };
  }

  /**
   * Create the progress row for an hourly-to-daily merge if it does not exist.
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
        batch_size,
        max_validator,
        completed
      )
      VALUES (
        ${input.hourStart}::timestamp,
        ${input.dayStart}::timestamp,
        ${input.partitionName},
        0,
        ${DAILY_MERGE_BATCH_SIZE},
        ${max_idx},
        false
      )
      ON CONFLICT (hour_start) DO NOTHING
    `;
  }

  /**
   * Merge the next validator batch for one source hour into the daily archive.
   */
  async mergeNextHourBatch(hourStart: Date): Promise<{ hourStart: Date; completed: boolean }> {
    return await this.prisma.$transaction(
      async (tx) => {
        const [progress] = await tx.$queryRaw<
          Array<{
            hour_start: Date;
            day_start: Date;
            next_batch_start: number;
            batch_size: number;
            max_validator: number;
            completed: boolean;
          }>
        >`
          SELECT
            hour_start,
            day_start,
            next_batch_start,
            batch_size,
            max_validator,
            completed
          FROM archive_hour_merge_progress
          WHERE hour_start = ${hourStart}::timestamp
          FOR UPDATE
        `;

        if (!progress) {
          throw new Error(`Missing daily merge progress for hour ${hourStart.toISOString()}`);
        }

        if (progress.completed) {
          return { hourStart: progress.hour_start, completed: true };
        }

        const batchStart = progress.next_batch_start;
        const batchEnd = batchStart + progress.batch_size;
        const completed = batchEnd > progress.max_validator;
        const nextDayStart = addDays(progress.day_start, 1);
        const dailyPartitionName = getDailyArchivePartitionNameForDailyMerge(
          'validator_daily_archive',
          progress.day_start,
        );

        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${dailyPartitionName}" PARTITION OF "validator_daily_archive" ` +
            `FOR VALUES FROM ('${progress.day_start.toISOString()}') TO ('${nextDayStart.toISOString()}')`,
        );

        await tx.$executeRaw`
          INSERT INTO validator_daily_archive (
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
            ${progress.day_start}::timestamp AS timestamp,
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
          WHERE "timestamp" = ${progress.hour_start}::timestamp
            AND validator_index >= ${batchStart}::int
            AND validator_index < ${batchEnd}::int
          ON CONFLICT (timestamp, validator_index) DO UPDATE SET
            data_by_slot = COALESCE(validator_daily_archive.data_by_slot, '[]'::jsonb) || EXCLUDED.data_by_slot,
            data_by_epoch = COALESCE(validator_daily_archive.data_by_epoch, '[]'::jsonb) || EXCLUDED.data_by_epoch,
            attestation_count = validator_daily_archive.attestation_count + EXCLUDED.attestation_count,
            missed_attestation_count = NULLIF(
              COALESCE(validator_daily_archive.missed_attestation_count, 0) + COALESCE(EXCLUDED.missed_attestation_count, 0),
              0
            )::smallint,
            sync_reward_total = validator_daily_archive.sync_reward_total + EXCLUDED.sync_reward_total,
            sync_missed_reward_total = validator_daily_archive.sync_missed_reward_total + EXCLUDED.sync_missed_reward_total,
            exec_reward_total = NULLIF(
              COALESCE(validator_daily_archive.exec_reward_total, 0::numeric) + COALESCE(EXCLUDED.exec_reward_total, 0::numeric),
              0::numeric
            ),
            block_reward_total = NULLIF(
              COALESCE(validator_daily_archive.block_reward_total, 0::bigint) + COALESCE(EXCLUDED.block_reward_total, 0::bigint),
              0::bigint
            ),
            cl_reward_total = validator_daily_archive.cl_reward_total + EXCLUDED.cl_reward_total,
            cl_missed_reward_total = validator_daily_archive.cl_missed_reward_total + EXCLUDED.cl_missed_reward_total,
            avg_attestation_delay = (
              (
                COALESCE(validator_daily_archive.avg_attestation_delay * validator_daily_archive.attestation_count, 0) +
                COALESCE(EXCLUDED.avg_attestation_delay * EXCLUDED.attestation_count, 0)
              ) / NULLIF(
                (CASE WHEN validator_daily_archive.avg_attestation_delay IS NOT NULL THEN validator_daily_archive.attestation_count ELSE 0 END) +
                (CASE WHEN EXCLUDED.avg_attestation_delay IS NOT NULL THEN EXCLUDED.attestation_count ELSE 0 END),
                0
              )
            )::real,
            attestation_efficiency = (
              (
                COALESCE(validator_daily_archive.attestation_efficiency * validator_daily_archive.attestation_count, 0) +
                COALESCE(EXCLUDED.attestation_efficiency * EXCLUDED.attestation_count, 0)
              ) / NULLIF(
                (CASE WHEN validator_daily_archive.attestation_efficiency IS NOT NULL THEN validator_daily_archive.attestation_count ELSE 0 END) +
                (CASE WHEN EXCLUDED.attestation_efficiency IS NOT NULL THEN EXCLUDED.attestation_count ELSE 0 END),
                0
              )
            )::real
        `;

        await tx.$executeRaw`
          UPDATE archive_hour_merge_progress
          SET
            next_batch_start = ${batchEnd}::int,
            completed = ${completed},
            completed_at = CASE WHEN ${completed} THEN NOW() ELSE completed_at END,
            updated_at = NOW()
          WHERE hour_start = ${progress.hour_start}::timestamp
        `;

        return { hourStart: progress.hour_start, completed };
      },
      {
        timeout: ms('5m'),
      },
    );
  }

  /**
   * Drop a source hourly partition after its progress row has completed.
   */
  async finalizeCompletedHour(hourStart: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [progress] = await tx.$queryRaw<Array<{ source_partition: string }>>`
        SELECT source_partition
        FROM archive_hour_merge_progress
        WHERE hour_start = ${hourStart}::timestamp
          AND completed = true
        FOR UPDATE
      `;

      if (!progress) {
        return;
      }

      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${progress.source_partition}"`);
    });
  }

  /**
   * Advance archive.lastDay after every expected hour for a day has completed.
   */
  async updateLastDayIfComplete(dayStart: Date, expectedHourlyPartitions: number): Promise<void> {
    const [{ completed_hours }] = await this.prisma.$queryRaw<[{ completed_hours: number }]>`
      SELECT COUNT(*)::int AS completed_hours
      FROM archive_hour_merge_progress
      WHERE day_start = ${dayStart}::timestamp
        AND completed = true
    `;

    if (completed_hours !== expectedHourlyPartitions) {
      return;
    }

    await this.prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: dayStart },
    });
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
 * Generate an hourly archive partition name inside the daily archive storage layer.
 */
function getHourlyArchivePartitionNameForDailyMerge(
  tableNamePrefix: string,
  timestamp: Date,
): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMddHH');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
