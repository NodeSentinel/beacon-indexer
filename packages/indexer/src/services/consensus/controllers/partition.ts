import { addHours } from 'date-fns';

import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { BeaconTime } from '@/src/services/consensus/utils/beaconTime.js';
import { getUTCDatetimeFlooredToHour } from '@/src/utils/date/index.js';

/**
 * Partition information for a slot-based partition
 */
interface SlotPartitionInfo {
  name: string;
  startSlot: number;
  endSlot: number; // Exclusive end for PostgreSQL
}

/**
 * Partition information for an epoch-based partition
 */
interface EpochPartitionInfo {
  name: string;
  startEpoch: number;
  endEpoch: number; // Exclusive end for PostgreSQL
}

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
    const hourEndTs = addHours(hourStartTs, 1).getTime(); // next UTC hour start
    const hourEndSlot = this.beaconTime.getSlotNumberFromTimestamp(hourEndTs);

    return {
      name: `${tableNamePrefix}_${startSlot}-${hourEndSlot - 1}`,
      startSlot,
      endSlot: hourEndSlot, // exclusive
    };
  }

  // Helper to build an epoch-based partition info object
  private makeEpochPartition(
    tableName: string,
    startEpochInclusive: number,
    endEpochExclusive: number,
  ): EpochPartitionInfo {
    return {
      name: `${tableName}_${startEpochInclusive}-${endEpochExclusive - 1}`,
      startEpoch: startEpochInclusive,
      endEpoch: endEpochExclusive,
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
    const { startSlot, endSlot } = this.beaconTime.getEpochSlots(epoch);

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
    const partitions = this.calculateSlotPartitions(epoch, 'committee');

    // Create all calculated partitions
    for (const partition of partitions) {
      await this.partitionStorage.createPartition(
        'committee',
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
    const endEpoch = this.beaconTime.getFirstEpochStartingAtOrAfter(nextHourTimestamp); // exclusive

    return this.makeEpochPartition(tableNamePrefix, startEpoch, endEpoch);
  }

  /**
   * Creates `epoch_rewards` table partition for the given epoch.
   */
  async createPartitionForEpochRewards(epoch: number): Promise<void> {
    const partition = this.calculateEpochPartition(epoch, 'epoch_rewards');

    await this.partitionStorage.createPartition(
      'epoch_rewards',
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
}
