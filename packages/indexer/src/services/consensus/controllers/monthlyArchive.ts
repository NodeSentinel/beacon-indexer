import { formatInTimeZone } from 'date-fns-tz';

import { MonthlyArchiveStorage } from '../storage/monthlyArchive.js';

/**
 * MonthlyArchiveController - Business logic for monthly archive aggregation.
 *
 * Aggregates daily archives into monthly archives:
 * 1. Checks if all days of a month have been archived in daily
 * 2. Creates monthly partition
 * 3. Aggregates daily data into monthly record
 * 4. Drops daily archive partitions
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

    // Discover daily partitions for this month
    const dailyPartitions = await this.storage.discoverDailyPartitionsForMonth(
      candidate.monthStart,
      candidate.monthEnd,
    );

    if (dailyPartitions.length === 0) {
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
   * - A month is eligible if all days have been archived (lastDay >= last day of month)
   */
  private async findMonthToArchive(): Promise<{ monthStart: Date; monthEnd: Date } | null> {
    const lastDay = await this.storage.getLastArchivedDay();
    if (!lastDay) {
      return null;
    }

    const lastMonth = await this.storage.getLastArchivedMonth();

    // The candidate month is the month after lastMonth, or the first possible month
    let candidateMonthStart: Date;
    if (lastMonth) {
      candidateMonthStart = getNextMonthStart(lastMonth);
    } else {
      // No month archived yet — find the oldest daily partition to determine the starting month
      const oldestDay = await this.storage.getOldestDailyPartition();
      if (!oldestDay) {
        return null;
      }
      candidateMonthStart = floorToUTCMonth(oldestDay);
    }

    const candidateMonthEnd = getNextMonthStart(candidateMonthStart);

    // The candidate month must be fully covered by daily archives:
    // lastDay must be >= the last day of the month (monthEnd - 1 day)
    const lastDayOfMonth = new Date(candidateMonthEnd.getTime() - 24 * 3600 * 1000);
    if (lastDay < lastDayOfMonth) {
      return null;
    }

    return { monthStart: candidateMonthStart, monthEnd: candidateMonthEnd };
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
 * Generate a monthly archive partition name.
 * Format: {tableNamePrefix}_{yyyyMM}
 */
export function getMonthlyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMM');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}
