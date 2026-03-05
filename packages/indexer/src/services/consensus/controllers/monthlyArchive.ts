import { formatInTimeZone } from 'date-fns-tz';
import ms from 'ms';

import { MonthlyArchiveStorage } from '../storage/monthlyArchive.js';

/**
 * MonthlyArchiveController - Business logic for monthly archive aggregation.
 *
 * Aggregates weekly archives into monthly archives:
 * 1. Checks if all weeks of a month have been archived in weekly
 * 2. Creates monthly partition
 * 3. Aggregates weekly data into monthly record
 * 4. Drops weekly archive partitions
 * 5. Updates Archive.lastMonth
 *
 * Triggered by EPOCH_PROCESSED events (same as weekly archive).
 * Archives only 1 month per call (the oldest eligible).
 */
export class MonthlyArchiveController {
  constructor(private readonly storage: MonthlyArchiveStorage) {}

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

    // Discover weekly partitions for this month
    const weeklyPartitions = await this.storage.discoverWeeklyPartitionsForMonth(
      candidate.monthStart,
      candidate.monthEnd,
    );

    if (weeklyPartitions.length === 0) {
      return null;
    }

    // Require all weeks of the month, unless this is the first month ever archived
    // (the first month can be partial because data may start mid-month).
    if (!candidate.isFirstMonth && weeklyPartitions.length !== candidate.expectedWeeks) {
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
      weeklyPartitions,
      monthlyPartitionName,
    );

    return candidate.monthStart;
  }

  /**
   * Find the oldest month eligible for archiving.
   *
   * Logic:
   * - lastMonth tells us what month was last archived (or null if never)
   * - lastWeek tells us the most recent weekly archive
   * - A month is eligible only when fully outside the 1-month retention window
   *   (lastWeek >= candidateMonthEnd + 1 month), ensuring weekly data always
   *   covers the last month
   */
  private async findMonthToArchive(): Promise<{
    monthStart: Date;
    monthEnd: Date;
    expectedWeeks: number;
    isFirstMonth: boolean;
  } | null> {
    const lastWeek = await this.storage.getLastArchivedWeek();
    if (!lastWeek) {
      return null;
    }

    const lastMonth = await this.storage.getLastArchivedMonth();

    // The candidate month is the month after lastMonth, or the first possible month
    let candidateMonthStart: Date;
    let isFirstMonth = false;
    if (lastMonth) {
      candidateMonthStart = getNextMonthStart(lastMonth);
    } else {
      // No month archived yet — find the oldest weekly partition to determine the starting month
      const oldestWeek = await this.storage.getOldestWeeklyPartition();
      if (!oldestWeek) {
        return null;
      }
      candidateMonthStart = floorToUTCMonth(oldestWeek);
      isFirstMonth = true;
    }

    const candidateMonthEnd = getNextMonthStart(candidateMonthStart);

    // We always retain 1 month of weekly data for queries.
    // A month is only eligible when its data is fully outside the retention window:
    // lastWeek must be >= candidateMonthEnd + 1 month (analogous to weekly archive's 7d retention).
    const retentionEnd = getNextMonthStart(candidateMonthEnd);
    if (lastWeek.getTime() < retentionEnd.getTime()) {
      return null;
    }

    // Count how many ISO weeks have their Monday within this month
    const expectedWeeks = countWeeksInMonth(candidateMonthStart, candidateMonthEnd);

    return {
      monthStart: candidateMonthStart,
      monthEnd: candidateMonthEnd,
      expectedWeeks,
      isFirstMonth,
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
 * Count how many ISO weeks have their Monday falling within [monthStart, monthEnd).
 */
function countWeeksInMonth(monthStart: Date, monthEnd: Date): number {
  let count = 0;
  const cursor = new Date(monthStart.getTime());

  // Find the first Monday >= monthStart
  const dayOfWeek = cursor.getUTCDay(); // 0=Sun, 1=Mon, ...
  if (dayOfWeek !== 1) {
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    cursor.setUTCDate(cursor.getUTCDate() + daysUntilMonday);
  }

  while (cursor.getTime() < monthEnd.getTime()) {
    count++;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return count;
}

/**
 * Generate a monthly archive partition name.
 * Format: {tableNamePrefix}_{yyyyMM}
 */
export function getMonthlyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMM');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
