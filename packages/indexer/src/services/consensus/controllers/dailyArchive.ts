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

    // Require all 24 hourly partitions, unless this is the first day ever archived
    // (lookback_slot may start mid-day, so the first day can be partial).
    if (!candidate.isFirstDay && hourlyPartitions.length !== 24) {
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
    isFirstDay: boolean;
  } | null> {
    const lastHour = await this.storage.getLastArchivedHour();
    if (!lastHour) {
      return null;
    }

    const lastDay = await this.storage.getLastArchivedDay();

    // The candidate day is the day after lastDay, or the first possible day
    let candidateDayStart: Date;
    let isFirstDay = false;
    if (lastDay) {
      candidateDayStart = new Date(lastDay.getTime() + 24 * 3600 * 1000);
    } else {
      // No day archived yet — find the oldest hourly partition to determine the starting day
      const oldestHour = await this.storage.getOldestArchivedHour();
      if (!oldestHour) {
        return null;
      }
      candidateDayStart = floorToUTCDay(oldestHour);
      isFirstDay = true;
    }

    const candidateDayEnd = new Date(candidateDayStart.getTime() + 24 * 3600 * 1000);

    // We always retain the last 24h of hourly data for queries.
    // A day is only eligible when its data is fully outside that retention window:
    // lastHour must be >= candidateDayEnd + 24h (analogous to hourly archive's
    // subHours(now, 2) cutoff in PartitionController.getHourToArchive).
    const retentionMs = 24 * 3600 * 1000;
    if (lastHour.getTime() - candidateDayEnd.getTime() < retentionMs) {
      return null;
    }

    return { dayStart: candidateDayStart, dayEnd: candidateDayEnd, isFirstDay };
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
