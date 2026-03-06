import { addDays, differenceInHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

import { DailyArchiveStorage } from '../storage/dailyArchive.js';

import { floorToUTCDay, floorToUTCHour } from '@/src/utils/date/index.js';

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
    // For the lookback day (lookback_slot may start mid-day) this is less than 24;
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

    // The candidate day is the day after lastDay, or the lookback_slot day
    let candidateDayStart: Date;
    let expectedHourlyPartitions = HOURS_PER_DAY;
    if (lastDay) {
      candidateDayStart = addDays(lastDay, 1);
    } else {
      candidateDayStart = this.lookbackDayStart;
      // Lookback day may be partial: lookback_slot can start mid-day, so we only
      // expect hours from lookbackSlot hour to end-of-day (not the full 24).
      const lookbackHour = floorToUTCHour(new Date(this.lookbackSlotTimestamp));
      expectedHourlyPartitions = differenceInHours(addDays(candidateDayStart, 1), lookbackHour);
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
 * Generate a daily archive partition name.
 * Format: {tableNamePrefix}_{yyyyMMdd}
 */
export function getDailyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMdd');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
