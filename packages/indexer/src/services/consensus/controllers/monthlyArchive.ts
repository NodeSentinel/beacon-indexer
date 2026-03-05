import { formatInTimeZone } from 'date-fns-tz';

import { MonthlyArchiveStorage } from '../storage/monthlyArchive.js';

/**
 * MonthlyArchiveController - Business logic for monthly archive aggregation.
 *
 * Aggregates daily archives into monthly archives (calendar-aligned):
 * 1. Checks if all days of a month have been archived in daily
 * 2. Creates monthly partition
 * 3. Aggregates daily data into monthly record
 * 4. Drops daily archive partitions
 * 5. Updates Archive.lastMonth
 *
 * Triggered by EPOCH_PROCESSED events (same as daily archive).
 * Archives only 1 month per call (the oldest eligible).
 */
export class MonthlyArchiveController {
  private readonly lookbackMonthStart: Date;

  constructor(
    private readonly storage: MonthlyArchiveStorage,
    lookbackSlotTimestamp: number,
  ) {
    this.lookbackMonthStart = floorToUTCMonth(new Date(lookbackSlotTimestamp));
  }

  /**
   * Main entry point: triggered on each EPOCH_PROCESSED event.
   *
   * @returns The archived month timestamp, or null if no eligible month found
   * @throws Error if archive fails
   */
  async archive(): Promise<Date | null> {
    // Determine the candidate month to archive
    const candidate = await this.findMonthToArchive();

    if (!candidate) {
      return null;
    }

    // Check if already archived
    const alreadyArchived = await this.storage.archiveExistsForMonth(candidate.monthStart);
    if (alreadyArchived) {
      return null;
    }

    // Discover daily partitions for this month
    const dailyPartitions = await this.storage.discoverDailyPartitionsForMonth(
      candidate.monthStart,
      candidate.monthEnd,
    );

    if (dailyPartitions.length === 0) {
      return null;
    }

    // Require all days of the month, unless this is the lookback_slot month
    // (lookback_slot may start mid-month, so that month can be partial).
    if (!candidate.isLookbackMonth && dailyPartitions.length !== candidate.expectedDays) {
      return null;
    }

    // Generate monthly partition name: validator_monthly_archive_YYYYMM
    const monthlyPartitionName = getMonthlyArchivePartitionName(
      'validator_monthly_archive',
      candidate.monthStart,
    );

    // Execute atomic archive
    await this.storage.archiveMonthAtomically(
      candidate.monthStart,
      candidate.monthEnd,
      dailyPartitions,
      monthlyPartitionName,
    );

    return candidate.monthStart;
  }

  /**
   * Find the oldest month eligible for archiving.
   *
   * Logic:
   * - lastMonth tells us what month was last archived (or null if never)
   * - lastDay tells us the most recent daily archive
   * - A month is eligible only when fully outside the 30-day retention window
   *   (lastDay >= candidateMonthEnd + 30 days), ensuring daily data always
   *   covers the last ~30 days
   */
  private async findMonthToArchive(): Promise<{
    monthStart: Date;
    monthEnd: Date;
    expectedDays: number;
    isLookbackMonth: boolean;
  } | null> {
    const lastDay = await this.storage.getLastArchivedDay();
    if (!lastDay) {
      return null;
    }

    const lastMonth = await this.storage.getLastArchivedMonth();

    // The candidate month is the month after lastMonth, or the lookback_slot month
    let candidateMonthStart: Date;
    if (lastMonth) {
      candidateMonthStart = getNextMonthStart(lastMonth);
    } else {
      candidateMonthStart = this.lookbackMonthStart;
    }

    const candidateMonthEnd = getNextMonthStart(candidateMonthStart);
    const isLookbackMonth = candidateMonthStart.getTime() === this.lookbackMonthStart.getTime();

    // We retain 30 days of daily data for queries.
    // A month is only eligible when its data is fully outside that retention window:
    // lastDay must be >= candidateMonthEnd + 30 days.
    const retentionMs = 30 * 24 * 3600 * 1000;
    if (lastDay.getTime() - candidateMonthEnd.getTime() < retentionMs) {
      return null;
    }

    // Count the number of days in this calendar month
    const expectedDays = daysInMonth(candidateMonthStart);

    return {
      monthStart: candidateMonthStart,
      monthEnd: candidateMonthEnd,
      expectedDays,
      isLookbackMonth,
    };
  }
}

/**
 * Floor a date to the start of its UTC month (1st day 00:00:00).
 */
function floorToUTCMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Get the start of the next month after the given date.
 */
function getNextMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Count the number of days in a given UTC month.
 */
function daysInMonth(monthStart: Date): number {
  const nextMonth = getNextMonthStart(monthStart);
  return (nextMonth.getTime() - monthStart.getTime()) / (24 * 3600 * 1000);
}

/**
 * Generate a monthly archive partition name.
 * Format: {tableNamePrefix}_{yyyyMM}
 */
export function getMonthlyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMM');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
