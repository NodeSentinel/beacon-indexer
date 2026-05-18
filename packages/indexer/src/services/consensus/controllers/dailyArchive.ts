import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

import { DailyArchiveStorage } from '../storage/dailyArchive.js';

import { floorToUTCDay, floorToUTCHour } from '@/src/utils/date/index.js';

/**
 * DailyArchiveController - Business logic for daily archive aggregation.
 *
 * Incrementally merges hourly archives into daily archives:
 * 1. Finds the oldest hourly partition outside the 24-hour query window
 * 2. Creates or resumes the daily progress row for that source hour
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
    // Resume an in-progress hour before looking for the next expected hour.
    const pendingCandidate = await this.storage.findPendingDailyMergeProgress();
    let candidate = pendingCandidate;
    if (!candidate) {
      candidate = await this.findNextExpectedHourToArchive();
    }

    if (!candidate) {
      return null;
    }

    if (!pendingCandidate) {
      // Store the batch cursor once. Retries use this row to continue from the
      // next validator range instead of re-merging earlier batches.
      await this.storage.startDailyMergeProgress({
        currentHour: candidate.currentHour,
        targetDay: candidate.targetDay,
        sourcePartition: candidate.sourcePartition,
      });
    }

    // Merge one validator-index range while holding the progress row lock.
    await this.storage.mergeNextHourBatch(candidate.targetDay);

    return candidate.currentHour;
  }

  /**
   * Pick the next hour that must be archived for the current day.
   *
   * The archive must not skip over missing hourly partitions. If 02:00 is
   * missing and 03:00 exists, this returns null until 02:00 is available.
   */
  private async findNextExpectedHourToArchive(): Promise<{
    currentHour: Date;
    targetDay: Date;
    sourcePartition: string;
  } | null> {
    const lastDay = await this.storage.getLastArchivedDay();
    const targetDay = lastDay ? addDays(lastDay, 1) : this.lookbackDayStart;
    const firstExpectedHour = lastDay
      ? targetDay
      : floorToUTCHour(new Date(this.lookbackSlotTimestamp));
    const progress = await this.storage.findDailyMergeProgress(targetDay);
    const nextExpectedHour = progress?.currentHour ?? firstExpectedHour;

    if (nextExpectedHour >= addDays(targetDay, 1)) {
      return null;
    }

    return await this.storage.findExpectedHourlyPartitionToMerge(nextExpectedHour);
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
