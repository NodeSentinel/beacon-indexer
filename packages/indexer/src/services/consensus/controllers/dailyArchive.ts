import { addDays, differenceInHours } from 'date-fns';
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
 * 3. Merges one validator batch atomically
 * 4. Drops the source hourly partition after all batches complete
 * 5. Updates Archive.lastDay after all expected hours for a day complete
 *
 * Triggered by EPOCH_PROCESSED events (same as hourly archive).
 * Merges only 1 validator batch per call.
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
    // Find the oldest hourly partition that has left the 24-hour query window.
    const candidate = await this.storage.findOldestHourlyPartitionToMerge();
    if (!candidate) {
      return null;
    }

    // Create the progress row once so retries resume from the stored batch pointer.
    await this.storage.ensureHourMergeProgress({
      hourStart: candidate.hourStart,
      dayStart: candidate.dayStart,
      partitionName: candidate.partitionName,
    });

    // Merge one validator batch atomically with a locked progress row.
    const result = await this.storage.mergeNextHourBatch(candidate.hourStart);

    // Drop the source partition only after every validator batch for the hour completed.
    if (result.completed) {
      await this.storage.finalizeCompletedHour(candidate.hourStart);
      await this.storage.updateLastDayIfComplete(
        candidate.dayStart,
        this.getExpectedHourlyPartitions(candidate.dayStart),
      );
    }

    return candidate.hourStart;
  }

  /**
   * Get the number of hourly partitions expected for a UTC day.
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
