import { formatInTimeZone } from 'date-fns-tz';

import { WeeklyArchiveStorage } from '../storage/weeklyArchive.js';

/**
 * WeeklyArchiveController - Business logic for weekly archive aggregation.
 *
 * Aggregates daily archives into weekly archives:
 * 1. Checks if 7 days of daily archives exist after lastWeek
 * 2. Creates weekly partition
 * 3. Aggregates daily data into weekly record
 * 4. Drops daily archive partitions
 * 5. Updates Archive.lastWeek
 *
 * Triggered by EPOCH_PROCESSED events (same as daily archive).
 * Archives only 1 week per call (the oldest eligible).
 */
export class WeeklyArchiveController {
  constructor(private readonly storage: WeeklyArchiveStorage) {}

  /**
   * Main entry point: triggered on each EPOCH_PROCESSED event.
   *
   * @returns The archived week timestamp, or null if no eligible week found
   * @throws Error if archive fails
   */
  async archive(): Promise<Date | null> {
    // Determine the candidate week to archive
    const candidate = await this.findWeekToArchive();

    if (!candidate) {
      return null;
    }

    // Check if already archived
    const alreadyArchived = await this.storage.archiveExistsForWeek(candidate.weekStart);
    if (alreadyArchived) {
      return null;
    }

    // Discover daily partitions for this week
    const dailyPartitions = await this.storage.discoverDailyPartitionsForWeek(
      candidate.weekStart,
      candidate.weekEnd,
    );

    if (dailyPartitions.length === 0) {
      return null;
    }

    // Generate weekly partition name: validator_weekly_archive_YYYYwWW
    const weeklyPartitionName = getWeeklyArchivePartitionName(
      'validator_weekly_archive',
      candidate.weekStart,
    );

    // Execute atomic archive
    await this.storage.archiveWeekAtomically(
      candidate.weekStart,
      dailyPartitions,
      weeklyPartitionName,
    );

    return candidate.weekStart;
  }

  /**
   * Find the oldest week eligible for archiving.
   *
   * Logic:
   * - lastWeek tells us what week was last archived (or null if never)
   * - lastDay tells us the most recent daily archive
   * - A week is eligible if all 7 days have been archived (lastDay >= weekEnd - 1 day)
   */
  private async findWeekToArchive(): Promise<{ weekStart: Date; weekEnd: Date } | null> {
    const lastDay = await this.storage.getLastArchivedDay();
    if (!lastDay) {
      return null;
    }

    const lastWeek = await this.storage.getLastArchivedWeek();

    // The candidate week is the week after lastWeek, or the first possible week
    let candidateWeekStart: Date;
    if (lastWeek) {
      candidateWeekStart = new Date(lastWeek.getTime() + 7 * 24 * 3600 * 1000);
    } else {
      // No week archived yet — find the oldest daily partition to determine the starting week
      const oldestDay = await this.storage.getOldestDailyPartition();
      if (!oldestDay) {
        return null;
      }
      candidateWeekStart = floorToUTCMonday(oldestDay);
    }

    const candidateWeekEnd = new Date(candidateWeekStart.getTime() + 7 * 24 * 3600 * 1000);

    // The candidate week must be fully covered by daily archives:
    // lastDay must be >= the last day of the week (weekEnd - 1 day = weekStart + 6 days)
    const lastDayOfWeek = new Date(candidateWeekEnd.getTime() - 24 * 3600 * 1000);
    if (lastDay < lastDayOfWeek) {
      return null;
    }

    return { weekStart: candidateWeekStart, weekEnd: candidateWeekEnd };
  }
}

/**
 * Floor a date to the start of its UTC ISO week (Monday 00:00:00).
 */
function floorToUTCMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay(); // 0=Sunday, 1=Monday, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

/**
 * Generate a weekly archive partition name.
 * Format: {tableNamePrefix}_{yyyy}w{ww}
 * where ww is the ISO week number.
 */
export function getWeeklyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  const year = formatInTimeZone(timestamp, 'UTC', 'yyyy');
  const week = formatInTimeZone(timestamp, 'UTC', 'II'); // ISO week number
  return `${tableNamePrefix}_${year}w${week}`;
}
