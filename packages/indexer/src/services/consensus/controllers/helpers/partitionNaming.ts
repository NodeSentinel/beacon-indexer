import { formatInTimeZone } from 'date-fns-tz';

import { PARTITION_TABLE_NAMES } from '@/src/services/consensus/controllers/partition.js';

/**
 * Generic parsed partition information.
 */
export interface ParsedPartition<T> {
  start: T;
  end: T;
  datetime?: Date;
}

/**
 * Generic function to parse a partition name with a start-end range.
 * Supports both new format with datetime suffix and old format without it.
 *
 * @param partitionName - The full name of the partition.
 * @param prefix - The expected prefix (e.g., "committee_").
 * @param parseValue - A function to parse the range values (e.g., parseInt).
 * @returns Parsed partition info or null if parsing fails.
 */
function parseRangedPartitionName<T>(
  partitionName: string,
  prefix: string,
  parseValue: (s: string) => T,
): ParsedPartition<T> | null {
  const baseRegex = `^${prefix}(\\d+)-(\\d+)`;

  // Try new format first: <prefix><start>-<end>_<datetime>
  const newFormatMatch = partitionName.match(new RegExp(`${baseRegex}_(\\d{10})$`));
  if (newFormatMatch) {
    const [, startStr, endStr, datetimeStr] = newFormatMatch;
    const year = parseInt(datetimeStr.slice(0, 4), 10);
    const month = parseInt(datetimeStr.slice(4, 6), 10) - 1; // 0-indexed
    const day = parseInt(datetimeStr.slice(6, 8), 10);
    const hour = parseInt(datetimeStr.slice(8, 10), 10);
    const datetime = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));

    return {
      start: parseValue(startStr),
      end: parseValue(endStr),
      datetime,
    };
  }

  // Fall back to old format: <prefix><start>-<end>
  const oldFormatMatch = partitionName.match(new RegExp(`${baseRegex}$`));
  if (oldFormatMatch) {
    const [, startStr, endStr] = oldFormatMatch;
    return {
      start: parseValue(startStr),
      end: parseValue(endStr),
    };
  }

  return null;
}

/**
 * Specialized parser for slot-based partition names.
 * @param partitionName - e.g., "committee_500-1599_2024011510" or "committee_500-1599"
 */
export function parseSlotPartitionName(partitionName: string): ParsedPartition<number> | null {
  return parseRangedPartitionName(partitionName, `${PARTITION_TABLE_NAMES.COMMITTEE}_`, (s) =>
    parseInt(s, 10),
  );
}

/**
 * Specialized parser for epoch-based partition names.
 * @param partitionName - e.g., "epoch_rewards_100-124_2024011510" or "epoch_rewards_100-124"
 */
export function parseEpochPartitionName(partitionName: string): ParsedPartition<number> | null {
  return parseRangedPartitionName(partitionName, `${PARTITION_TABLE_NAMES.EPOCH_REWARDS}_`, (s) =>
    parseInt(s, 10),
  );
}

/**
 * Generates a standardized partition name with a datetime suffix.
 * Format: {tableNamePrefix}_{start}-{end}_{yyyyMMddHH}
 *
 * @param tableNamePrefix - The base name of the table (e.g., "committee").
 * @param start - The starting number of the range (inclusive).
 * @param end - The ending number of the range (inclusive).
 * @param timestamp - The UTC hour timestamp for the partition.
 * @returns The full partition name.
 */
export function getPartitionName(
  tableNamePrefix: string,
  start: number,
  end: number,
  timestamp: Date,
): string {
  const range = `${start}-${end}`;
  const tableName = `${tableNamePrefix}_${range}`;
  // Use UTC timezone to ensure consistent partition naming regardless of server timezone
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMddHH');
  return `${tableName}_${datetimeSuffix}`;
}

/**
 * Generates a partition name for hourly archive tables.
 * Format: {tableNamePrefix}_{yyyyMMddHH}
 *
 * @param tableNamePrefix - The base name of the table (e.g., "validator_hourly_archive").
 * @param timestamp - The UTC hour timestamp for the partition.
 * @returns The full partition name.
 */
export function getHourlyArchivePartitionName(tableNamePrefix: string, timestamp: Date): string {
  // Use UTC timezone to ensure consistent partition naming regardless of server timezone
  const datetimeSuffix = formatInTimeZone(timestamp, 'UTC', 'yyyyMMddHH');
  return `${tableNamePrefix}_${datetimeSuffix}`;
}

/**
 * Quotes a PostgreSQL identifier for partition DDL and maintenance statements.
 */
export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Quotes a published daily archive partition name after validating its format.
 */
export function quoteDailyArchivePartitionName(partitionName: string): string {
  if (!/^validator_daily_archive_\d{8}$/.test(partitionName)) {
    throw new Error(`Unsafe daily archive partition name: ${partitionName}`);
  }

  return quotePostgresIdentifier(partitionName);
}
