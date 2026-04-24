import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { subHours } from 'date-fns';

import {
  getPartitionName,
  ParsedPartition,
  parseEpochPartitionName,
  parseSlotPartitionName,
} from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { getUTCDatetimeFlooredToHour } from '@/src/utils/date/index.js';

/**
 * Partition information for a slot-based partition
 */
export interface SlotPartitionInfo {
  name: string;
  startSlot: number;
  endSlot: number; // Inclusive
}

/**
 * Partition information for an epoch-based partition
 */
export interface EpochPartitionInfo {
  name: string;
  startEpoch: number;
  endEpoch: number; // Inclusive
}
export interface HourArchiveCandidate {
  hourStart: Date;
  committeePartitionName: string;
  epochRewardsPartitionName: string;
  startSlot: number;
  endSlot: number; // Inclusive
  startEpoch: number;
  endEpoch: number; // Inclusive
}

/**
 * Partition table names - centralized constants to avoid typos and ensure consistency
 */
export const PARTITION_TABLE_NAMES = {
  COMMITTEE: 'committee',
  EPOCH_REWARDS: 'epoch_rewards',
} as const;

/**
 * PartitionController - Business logic for partition management
 *
 * Handles:
 * - Creating partitions for different tables (committee, epoch_rewards, etc.)
 * - Calculating partition ranges based on epoch/slot logic
 * - Ensuring all required partitions exist before processing epochs
 */
export class PartitionController {
  constructor(
    private readonly partitionStorage: PartitionStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  // Helper to create a partition for a UTC hour
  private makeHourPartitionForSlot(tableNamePrefix: string, startSlot: number): SlotPartitionInfo {
    const hourStartTs = this.beaconTime.getTimestampFromSlotNumber(startSlot);
    const hourEndTs = hourStartTs + 3_600_000; // add 1 hour in milliseconds
    const hourEndSlotExclusive = this.beaconTime.getSlotNumberFromTimestamp(hourEndTs);
    const endSlot = hourEndSlotExclusive - 1; // Convert to inclusive

    // Calculate UTC hour timestamp for datetime suffix
    const hourTimestamp = getUTCDatetimeFlooredToHour(hourStartTs);
    const name = getPartitionName(tableNamePrefix, startSlot, endSlot, hourTimestamp);

    return {
      name,
      startSlot,
      endSlot, // inclusive
    };
  }

  // Helper to build an epoch-based partition info object
  private makeEpochPartition(
    tableName: string,
    startEpoch: number,
    endEpoch: number, // inclusive
  ): EpochPartitionInfo {
    // Calculate UTC hour timestamp from start epoch for datetime suffix
    const epochTimestamp = this.beaconTime.getTimestampFromEpochNumber(startEpoch);
    const hourTimestamp = getUTCDatetimeFlooredToHour(epochTimestamp);

    const name = getPartitionName(tableName, startEpoch, endEpoch, hourTimestamp);

    return {
      name,
      startEpoch,
      endEpoch, // inclusive
    };
  }

  /**
   * Calculate UTC hour-aligned partitions needed for an epoch.
   * Returns an array of partition info (1 or 2 partitions depending on if the epoch spans multiple UTC hours).
   *
   * @param epoch - The epoch number
   * @param tableNamePrefix - Name of the table (for partition naming)
   * @returns Array of partition info objects
   */
  private calculateSlotPartitions(epoch: number, tableNamePrefix: string): SlotPartitionInfo[] {
    const { endSlot, startSlot } = this.beaconTime.getEpochSlots(epoch);

    const firstSlotToProcess = Math.max(startSlot, this.beaconTime.getLookbackSlot());
    if (firstSlotToProcess > endSlot) return [];

    const partitionOneFirstSlot =
      this.beaconTime.getSlotAtStartOfUTCHourContaining(firstSlotToProcess);
    const partitionOne = this.makeHourPartitionForSlot(tableNamePrefix, partitionOneFirstSlot);

    // if endSlot is still within partitionOne, only 1 partition
    if (endSlot < partitionOne.endSlot) return [partitionOne];

    const partitionTwoFirstSlot = this.beaconTime.getSlotAtStartOfUTCHourContaining(endSlot);
    if (partitionTwoFirstSlot === partitionOneFirstSlot) return [partitionOne]; // paranoia / safety

    return [partitionOne, this.makeHourPartitionForSlot(tableNamePrefix, partitionTwoFirstSlot)];
  }

  /**
   * Create committee table partitions for the given epoch.
   * Partitions are aligned to UTC hour boundaries (e.g., 10:00-11:00, 11:00-12:00).
   *
   * Example: If lookbackSlot is 500 (10:35), the first partition will cover
   * slots 500-600 (from 10:35 to 11:00), then 600-1600 (11:00-12:00), etc.
   *
   * @param epoch - The epoch number
   */
  async createPartitionForCommittee(epoch: number): Promise<void> {
    const partitions = this.calculateSlotPartitions(epoch, PARTITION_TABLE_NAMES.COMMITTEE);

    // Create all calculated partitions
    for (const partition of partitions) {
      await this.partitionStorage.createPartition(
        PARTITION_TABLE_NAMES.COMMITTEE,
        partition.name,
        partition.startSlot,
        partition.endSlot,
      );
    }
  }

  /**
   * Calculates the epoch partition for a given epoch.
   *
   * Partitions are aligned to UTC hours. An epoch belongs to the partition
   * of the hour where it STARTS, regardless of where it ends.
   *
   * Example: epoch starting at 13:59 goes to 13:00 hour partition,
   * even if it ends at 14:01.
   */
  private calculateEpochPartition(epoch: number, tableNamePrefix: string): EpochPartitionInfo {
    // Use the epoch's start timestamp directly
    const epochTimestamp = this.beaconTime.getTimestampFromEpochNumber(epoch);

    // Round to UTC hour boundary using existing helper
    const hourStartDate = getUTCDatetimeFlooredToHour(epochTimestamp);
    const hourStartTimestamp = hourStartDate.getTime();
    const nextHourTimestamp = hourStartTimestamp + 3_600_000; // add 1 hour

    // Get first epoch starting at or after each hour boundary
    const startEpoch = this.beaconTime.getFirstEpochStartingAtOrAfter(hourStartTimestamp);
    const endEpochExclusive = this.beaconTime.getFirstEpochStartingAtOrAfter(nextHourTimestamp);
    const endEpoch = endEpochExclusive - 1; // Convert to inclusive

    return this.makeEpochPartition(tableNamePrefix, startEpoch, endEpoch);
  }

  /**
   * Creates `epoch_rewards` table partition for the given epoch.
   */
  async createPartitionForEpochRewards(epoch: number): Promise<void> {
    const partition = this.calculateEpochPartition(epoch, PARTITION_TABLE_NAMES.EPOCH_REWARDS);

    await this.partitionStorage.createPartition(
      PARTITION_TABLE_NAMES.EPOCH_REWARDS,
      partition.name,
      partition.startEpoch,
      partition.endEpoch,
    );
  }

  /**
   * Delete a partition by name
   * @param partitionName - Name of the partition to delete
   */
  async dropPartition(partitionName: string): Promise<void> {
    await this.partitionStorage.dropPartition(partitionName);
  }

  /**
   * Ensures all partitions required for processing an epoch are created.
   * This is the main method called before processing an epoch.
   *
   * @param epoch - The epoch number.
   */
  async createPartitionsToProcessEpoch(epoch: number): Promise<void> {
    // Create committee partitions
    await this.createPartitionForCommittee(epoch);

    // Create epoch_rewards partition
    await this.createPartitionForEpochRewards(epoch);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ARCHIVE CANDIDATE DISCOVERY
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Discover the oldest eligible hour for archiving by scanning active partitions.
   *
   * This method:
   * 1. Queries the catalog for committee and epoch_rewards partitions
   * 2. Parses partition names to extract bounds and datetime
   * 3. Groups partitions by UTC hour using datetime from partition name
   * 4. Intersects hours where both committee and epoch_rewards partitions exist
   * 5. Filters to hours <= nowHour - 2h (to keep raw data for last hour)
   * 6. Returns the oldest eligible hour with all partition info
   *
   * @returns The oldest eligible candidate or null if none found
   */
  async getHourToArchive(): Promise<HourArchiveCandidate | null> {
    const eligibleCutoff = subHours(getUTCDatetimeFlooredToHour(Date.now()), 2);

    // Discover partitions
    const [committeeNames, epochRewardsNames] = await Promise.all([
      this.partitionStorage.discoverPartitions(PARTITION_TABLE_NAMES.COMMITTEE),
      this.partitionStorage.discoverPartitions(PARTITION_TABLE_NAMES.EPOCH_REWARDS),
    ]);

    // Parse and group by hour
    const parseAndGroup = (
      names: string[],
      parseFn: (name: string) => ParsedPartition<number> | null,
    ) => {
      const byHour = new Map<string, { name: string; start: number; end: number }>();
      for (const name of names) {
        const parsed = parseFn(name);
        if (!parsed?.datetime) {
          throw new Error(`Invalid partition name: ${name}`);
        }
        if (parsed.datetime <= eligibleCutoff) {
          const hourKey = parsed.datetime.toISOString();
          byHour.set(hourKey, { name, start: parsed.start, end: parsed.end });
        }
      }
      return byHour;
    };

    const committeeByHour = parseAndGroup(committeeNames, parseSlotPartitionName);
    const epochRewardsByHour = parseAndGroup(epochRewardsNames, parseEpochPartitionName);

    // Validate matching pairs
    const allHours = new Set([...committeeByHour.keys(), ...epochRewardsByHour.keys()]);
    for (const hourKey of allHours) {
      if (!committeeByHour.has(hourKey)) {
        throw new Error(`Missing committee partition for hour: ${new Date(hourKey).toISOString()}`);
      }
      if (!epochRewardsByHour.has(hourKey)) {
        throw new Error(
          `Missing epoch_rewards partition for hour: ${new Date(hourKey).toISOString()}`,
        );
      }
    }

    // Find oldest eligible hour
    if (allHours.size === 0) {
      return null;
    }

    const oldestHourKey = [...allHours].sort()[0];
    const committee = committeeByHour.get(oldestHourKey)!;
    const epochRewards = epochRewardsByHour.get(oldestHourKey)!;

    return {
      hourStart: new Date(oldestHourKey),
      committeePartitionName: committee.name,
      epochRewardsPartitionName: epochRewards.name,
      startSlot: committee.start,
      endSlot: committee.end,
      startEpoch: epochRewards.start,
      endEpoch: epochRewards.end,
    };
  }
}
