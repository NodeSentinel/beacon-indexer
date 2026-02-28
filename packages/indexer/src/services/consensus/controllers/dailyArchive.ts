import { formatInTimeZone } from 'date-fns-tz';

import { DailyArchiveStorage } from '../storage/dailyArchive.js';

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
   * - A day is eligible if all 24 hours have been archived (lastHour >= dayEnd - 1h)
   * - We keep at least 24h of hourly data, so candidate must be < lastHour - 24h
   */
  private async findDayToArchive(): Promise<{ dayStart: Date; dayEnd: Date } | null> {
    const lastHour = await this.storage.getLastArchivedHour();
    if (!lastHour) {
      return null;
    }

    const lastDay = await this.storage.getLastArchivedDay();

    // The candidate day is the day after lastDay, or the first possible day
    let candidateDayStart: Date;
    if (lastDay) {
      candidateDayStart = new Date(lastDay.getTime() + 24 * 3600 * 1000);
    } else {
      // No day archived yet - use the floor of lastHour's date minus enough buffer
      // to ensure we have a full day. Start from the oldest possible day.
      // Find the oldest hourly archive day by looking at the earliest partition.
      candidateDayStart = floorToUTCDay(lastHour);
      // Go back to find the actual first day with data
      // For now, start from lastHour's day and check if we have enough data
      // We need lastHour to be at least 24h after the candidate day start
      const earliestPossibleDay = new Date(lastHour.getTime() - 30 * 24 * 3600 * 1000);
      candidateDayStart = floorToUTCDay(earliestPossibleDay);
    }

    const candidateDayEnd = new Date(candidateDayStart.getTime() + 24 * 3600 * 1000);

    // The candidate day must be fully covered by hourly archives:
    // lastHour must be >= the last hour of the day (dayEnd - 1h = dayStart + 23h)
    const lastHourOfDay = new Date(candidateDayEnd.getTime() - 3600 * 1000);
    if (lastHour < lastHourOfDay) {
      return null;
    }

    return { dayStart: candidateDayStart, dayEnd: candidateDayEnd };
  }
}

/**
 * Floor a date to the start of its UTC day (00:00:00).
 */
function floorToUTCDay(date: Date): Date {
  const msPerDay = 24 * 60 * 60 * 1000;
  return new Date(Math.floor(date.getTime() / msPerDay) * msPerDay);
}

/**
 * Generate a daily archive partition name.
 * Format: {tableNamePrefix}_{yyyyMMdd}
 */
export function getDailyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
