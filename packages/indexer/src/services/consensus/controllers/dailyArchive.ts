import { addDays, addHours, differenceInHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

import { DailyArchiveStorage } from '../storage/dailyArchive.js';

import { floorToUTCDay, floorToUTCHour } from '@/src/utils/date/index.js';

const HOURS_PER_DAY = 24;

/**
 * DailyArchiveController - Business logic for daily archive aggregation.
 *
 * Incrementally merges hourly archives into daily archives:
 * 1. Finds the oldest hourly partition outside the 24-hour query window
 * 2. Creates or resumes a progress row for that source hour
 * 3. Merges one validator-index range for that hour in a transaction
 * 4. Drops the source hourly partition after all batches complete
 * 5. Updates Archive.lastDay after all expected hours for a day complete
 *
 * Triggered by EPOCH_PROCESSED events (same as hourly archive).
 * Each call processes one validator-index range for one hourly partition.
 * Example: validator indexes 0-4999, then 5000-9999, until the hour is complete.
 */
export class DailyArchiveController {
  private readonly lookbackDayStart: Date;
  private readonly lookbackSlotTimestamp: number;

  constructor(
    private readonly storage: DailyArchiveStorage,
    lookbackSlotTimestamp: number,
  ) {
    this.lookbackSlotTimestamp = lookbackSlotTimestamp;
    this.lookbackDayStart = floorToUTCDay(new Date(lookbackSlotTimestamp));
  }

  /**
   * Main entry point: triggered on each EPOCH_PROCESSED event.
   *
   * @returns The merged hour timestamp, or null if no eligible hour found
   * @throws Error if archive fails
   */
  async archive(): Promise<Date | null> {
    // Resume an in-progress hour before starting a new hour so each source
    // partition is merged exactly once and in timestamp order.
    const candidate =
      (await this.storage.findPendingHourMergeProgress()) ??
      (await this.findNextExpectedHourToArchive());
    if (!candidate) {
      return null;
    }

    // Store the batch cursor once. Retries use this row to continue from the
    // next validator range instead of re-merging earlier batches.
    await this.storage.ensureHourMergeProgress({
      hourStart: candidate.hourStart,
      dayStart: candidate.dayStart,
      partitionName: candidate.partitionName,
    });

    // Merge one validator-index range while holding the progress row lock.
    await this.storage.mergeNextHourBatch(
      candidate.hourStart,
      this.getExpectedHourlyPartitions(candidate.dayStart),
    );

    return candidate.hourStart;
  }

  /**
   * Pick the next hour that must be archived for the current day.
   *
   * The archive must not skip over missing hourly partitions. If 02:00 is
   * missing and 03:00 exists, this returns null until 02:00 is available.
   */
  private async findNextExpectedHourToArchive(): Promise<{
    hourStart: Date;
    dayStart: Date;
    partitionName: string;
  } | null> {
    const lastDay = await this.storage.getLastArchivedDay();
    const dayStart = lastDay ? addDays(lastDay, 1) : this.lookbackDayStart;
    const firstExpectedHour = lastDay
      ? dayStart
      : floorToUTCHour(new Date(this.lookbackSlotTimestamp));
    const completedHours = await this.storage.countCompletedHoursForDay(dayStart);
    const nextExpectedHour = addHours(firstExpectedHour, completedHours);

    if (nextExpectedHour >= addDays(dayStart, 1)) {
      return null;
    }

    return await this.storage.findExpectedHourlyPartitionToMerge(nextExpectedHour);
  }

  /**
   * Return how many hourly source partitions must complete the given UTC day.
   *
   * Normal days require 24 hours. The first lookback day can start mid-day, so
   * it only requires the hours from the configured lookback hour to midnight.
   */
  private getExpectedHourlyPartitions(dayStart: Date): number {
    if (dayStart.getTime() !== this.lookbackDayStart.getTime()) {
      return HOURS_PER_DAY;
    }

    const lookbackHour = floorToUTCHour(new Date(this.lookbackSlotTimestamp));
    return differenceInHours(addDays(dayStart, 1), lookbackHour);
  }
}

/**
 * Generate a daily archive partition name.
 * Format: {tableNamePrefix}_{yyyyMMdd}
 */
export function getDailyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
