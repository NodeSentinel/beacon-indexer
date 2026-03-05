import { addDays, differenceInHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

import { DailyArchiveStorage } from '../storage/dailyArchive.js';

const MS_PER_DAY = 24 * 3600 * 1000;
const HOURS_PER_DAY = 24;

/**
 * DailyArchiveController - Business logic for daily archive aggregation.
 *
 * Aggregates hourly archives into daily archives:
 * 1. Checks if 24+ hours of hourly archives exist after lastDay
 * 2. Creates daily partition
 * 3. Aggregates hourly data into daily record
 * 4. Drops hourly archive partitions
 * 5. Updates Archive.lastDay
 *
 * Triggered by EPOCH_PROCESSED events (same as hourly archive).
 * Archives only 1 day per call (the oldest eligible).
 */
export class DailyArchiveController {
  constructor(private readonly storage: DailyArchiveStorage) {}

  /**
   * Main entry point: triggered on each EPOCH_PROCESSED event.
   *
   * @returns The archived day timestamp, or null if no eligible day found
   * @throws Error if archive fails
   */
  async archive(): Promise<Date | null> {
    // Determine the candidate day to archive
    const candidate = await this.findDayToArchive();

    if (!candidate) {
      return null;
    }

    // Check if already archived
    const alreadyArchived = await this.storage.archiveExistsForDay(candidate.dayStart);
    if (alreadyArchived) {
      return null;
    }

    // Discover hourly partitions for this day
    const hourlyPartitions = await this.storage.discoverHourlyPartitionsForDay(
      candidate.dayStart,
      candidate.dayEnd,
    );

    if (hourlyPartitions.length === 0) {
      return null;
    }

    // Require the expected number of hourly partitions for this day.
    // For the first day (lookback_slot may start mid-day) this is less than 24;
    // for all subsequent days it's exactly 24.
    if (hourlyPartitions.length !== candidate.expectedHourlyPartitions) {
      return null;
    }

    // Generate daily partition name: validator_daily_archive_YYYYMMDD
    const dailyPartitionName = getDailyArchivePartitionName(
      'validator_daily_archive',
      candidate.dayStart,
    );

    // Execute atomic archive
    await this.storage.archiveDayAtomically(
      candidate.dayStart,
      hourlyPartitions,
      dailyPartitionName,
    );

    return candidate.dayStart;
  }

  /**
   * Find the oldest day eligible for archiving.
   *
   * Logic:
   * - lastDay tells us what day was last archived (or null if never)
   * - lastHour tells us the most recent hourly archive
   * - A day is eligible only when fully outside the 24h retention window
   *   (lastHour >= candidateDayEnd + 24h), ensuring hourly data always covers the last 24h
   */
  private async findDayToArchive(): Promise<{
    dayStart: Date;
    dayEnd: Date;
    expectedHourlyPartitions: number;
  } | null> {
    const lastHour = await this.storage.getLastArchivedHour();
    if (!lastHour) {
      return null;
    }

    const lastDay = await this.storage.getLastArchivedDay();

    // The candidate day is the day after lastDay, or the first possible day
    let candidateDayStart: Date;
    let expectedHourlyPartitions = HOURS_PER_DAY;
    if (lastDay) {
      candidateDayStart = addDays(lastDay, 1);
    } else {
      // No day archived yet — find the oldest hourly partition to determine the starting day
      const oldestHour = await this.storage.getOldestArchivedHour();
      if (!oldestHour) {
        return null;
      }
      candidateDayStart = floorToUTCDay(oldestHour);
      // First day may be partial: lookback_slot can start mid-day, so we only
      // expect hours from oldestHour to end-of-day (not the full 24).
      expectedHourlyPartitions = differenceInHours(addDays(candidateDayStart, 1), oldestHour);
    }

    const candidateDayEnd = addDays(candidateDayStart, 1);

    // We always retain the last 24h of hourly data for queries.
    // A day is only eligible when its data is fully outside that retention window:
    // lastHour must be >= candidateDayEnd + 24h (analogous to hourly archive's
    // subHours(now, 2) cutoff in PartitionController.getHourToArchive).
    if (differenceInHours(lastHour, candidateDayEnd) < HOURS_PER_DAY) {
      return null;
    }

    return { dayStart: candidateDayStart, dayEnd: candidateDayEnd, expectedHourlyPartitions };
  }
}

/**
 * Floor a date to the start of its UTC day (00:00:00).
 * Note: date-fns startOfDay uses local timezone, so we floor manually for UTC.
 */
function floorToUTCDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_DAY) * MS_PER_DAY);
}

/**
 * Generate a daily archive partition name.
 * Format: {tableNamePrefix}_{yyyyMMdd}
 */
export function getDailyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
