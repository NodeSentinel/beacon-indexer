import { addHours, startOfHour } from 'date-fns';

import { PartitionStorage } from '../storage/partition.js';
import { BeaconTime } from '../utils/beaconTime.js';

/**
 * Partition information for a slot-based partition
 */
interface SlotPartitionInfo {
  name: string;
  startSlot: number;
  endSlot: number; // Exclusive end for PostgreSQL
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
  private makeHourPartition(tableName: string, startSlotTimestamp: number): SlotPartitionInfo {
    const hourStartTs = this.beaconTime.getTimestampFromSlotNumber(startSlotTimestamp);
    const hourEndTs = addHours(hourStartTs, 1).getTime(); // next UTC hour start
    const hourEndSlot = this.beaconTime.getSlotNumberFromTimestamp(hourEndTs);

    return {
      name: `${tableName}_${startSlotTimestamp}-${hourEndSlot - 1}`,
      startSlot: startSlotTimestamp,
      endSlot: hourEndSlot, // exclusive
    };
  }

  /**
   * Calculate UTC hour-aligned partitions needed for an epoch.
   * Returns an array of partition info (1 or 2 partitions depending on if the epoch spans multiple UTC hours).
   *
   * @param epoch - The epoch number
   * @param tableName - Name of the table (for partition naming)
   * @returns Array of partition info objects
   */
  private calculateSlotPartitions(epoch: number, tableName: string): SlotPartitionInfo[] {
    const { startSlot, endSlot } = this.beaconTime.getEpochSlots(epoch);

    const firstSlotToProcess = Math.max(startSlot, this.beaconTime.getLookbackSlot());
    if (firstSlotToProcess > endSlot) return [];

    const partitionOneFirstSlot =
      this.beaconTime.getSlotAtStartOfUTCHourContaining(firstSlotToProcess);
    const partitonOne = this.makeHourPartition(tableName, partitionOneFirstSlot);

    // if endSlot is still within partitionOne, only 1 partition
    if (endSlot < partitonOne.endSlot) return [partitonOne];

    const partitionTwoFirstSlot = this.beaconTime.getSlotAtStartOfUTCHourContaining(endSlot);
    if (partitionTwoFirstSlot === partitionOneFirstSlot) return [partitonOne]; // paranoia / safety

    return [partitonOne, this.makeHourPartition(tableName, partitionTwoFirstSlot)];
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
   * Create epoch_rewards table partition for the given epoch.
   * Partitions epoch_rewards by epoch ranges (e.g., 100 epochs per partition).
   *
   * @param epoch - The epoch number
   */
  async createPartitionForEpochRewards(epoch: number): Promise<void> {
    // For epoch_rewards, we partition by epoch ranges
    // Each partition covers a range of epochs (e.g., 100 epochs per partition)
    // This is simpler than slot-based partitioning

    // Calculate partition boundaries
    // Using 100 epochs per partition as a reasonable default
    // This can be adjusted based on data volume
    const epochsPerPartition = 100;
    const partitionStartEpoch = Math.floor(epoch / epochsPerPartition) * epochsPerPartition;
    const partitionEndEpoch = partitionStartEpoch + epochsPerPartition - 1;
    const partitionName = `epoch_rewards_epoch_${partitionStartEpoch}`;
    const exclusiveEndEpoch = partitionEndEpoch + 1; // PostgreSQL uses exclusive end

    await this.partitionStorage.createPartition(
      'epoch_rewards',
      partitionName,
      partitionStartEpoch,
      exclusiveEndEpoch,
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
   * Ensure all partitions required for processing an epoch are created.
   * This is the main method called before processing an epoch.
   *
   * @param epoch - The epoch number
   */
  async ensureAllPartitionsForEpoch(epoch: number): Promise<void> {
    // Create committee partitions
    await this.createPartitionForCommittee(epoch);

    // Create epoch_rewards partition
    await this.createPartitionForEpochRewards(epoch);
  }
}
