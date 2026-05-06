import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { ethereumConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { describe, expect, it, vi } from 'vitest';

import {
  parseEpochPartitionName,
  parseSlotPartitionName,
} from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import {
  PARTITION_TABLE_NAMES,
  PartitionController,
} from '@/src/services/consensus/controllers/partition.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';

// Defines the partition creation call captured from the storage mock.
type CreatedPartition = {
  tableName: string;
  partitionName: string;
  start: number;
  end: number;
};

// Creates a partition controller with storage calls captured in memory.
function createPartitionController(lookbackSlot: number) {
  const createdPartitions: CreatedPartition[] = [];

  const partitionStorage = {
    createPartition: vi.fn(
      async (tableName: string, partitionName: string, start: number, end: number) => {
        createdPartitions.push({ tableName, partitionName, start, end });
      },
    ),
  } as unknown as PartitionStorage;

  const beaconTime = new BeaconTime({
    genesisTimestamp: ethereumConfig.beacon.genesisTimestamp,
    slotDurationMs: ethereumConfig.beacon.slotDuration,
    slotsPerEpoch: ethereumConfig.beacon.slotsPerEpoch,
    epochsPerSyncCommitteePeriod: ethereumConfig.beacon.epochsPerSyncCommitteePeriod,
    lookbackSlot,
  });

  return {
    beaconTime,
    createdPartitions,
    partitionController: new PartitionController(partitionStorage, beaconTime),
  };
}

describe('PartitionController', () => {
  // This suite locks the first Ethereum committee partition when lookback starts inside a UTC hour.
  describe('createPartitionsToProcessEpoch', () => {
    it('starts the first committee partition at the first slot inside its UTC hour', async () => {
      // Use the real Ethereum lookback slot that starts at 2026-05-05T18:00:11Z.
      const lookbackSlot = 14264999;

      // Process the first epoch whose epoch_rewards partition belongs to the 18:00 UTC hour.
      const epoch = 445782;

      // Build the controller with an in-memory storage mock.
      const { beaconTime, createdPartitions, partitionController } =
        createPartitionController(lookbackSlot);

      // Verify the real edge condition before creating partitions.
      const firstSlotInHour = beaconTime.getSlotAtStartOfUTCHourContaining(lookbackSlot);
      expect(firstSlotInHour).toBe(lookbackSlot);

      // Create both committee and epoch_rewards partitions for the epoch.
      await partitionController.createPartitionsToProcessEpoch(epoch);

      // Find the committee partition that starts at the effective lookback slot.
      const committeePartition = createdPartitions.find(
        (partition) => partition.tableName === PARTITION_TABLE_NAMES.COMMITTEE,
      );

      // Find the epoch_rewards partition created for the same processing hour.
      const epochRewardsPartition = createdPartitions.find(
        (partition) => partition.tableName === PARTITION_TABLE_NAMES.EPOCH_REWARDS,
      );

      // Parse the committee partition name so its slot range and hour can be asserted.
      const parsedCommittee = parseSlotPartitionName(committeePartition?.partitionName ?? '');

      // Parse the epoch_rewards partition name so its hour can be paired with committee.
      const parsedEpochRewards = parseEpochPartitionName(
        epochRewardsPartition?.partitionName ?? '',
      );

      // Confirm the committee partition starts at the first indexed slot in the UTC hour.
      expect(parsedCommittee?.start).toBe(lookbackSlot);
      expect(parsedCommittee?.start).toBe(firstSlotInHour);

      // Confirm committee and epoch_rewards are both named for the same 18:00 UTC hour.
      expect(parsedCommittee?.datetime?.toISOString()).toBe('2026-05-05T18:00:00.000Z');
      expect(parsedEpochRewards?.datetime?.toISOString()).toBe('2026-05-05T18:00:00.000Z');
    });

    it('uses the same first-hour name and range for committee and epoch_rewards from the lookback epoch', async () => {
      // Use the real Ethereum lookback slot that starts during epoch 445781.
      const lookbackSlot = 14264999;

      // Process the lookback epoch and the next epoch in the same UTC hour.
      const lookbackEpoch = 445781;
      const nextEpoch = 445782;

      // Build the controller with an in-memory storage mock.
      const { createdPartitions, partitionController } = createPartitionController(lookbackSlot);

      // Create partitions for both epochs that belong to the first partial UTC hour.
      await partitionController.createPartitionsToProcessEpoch(lookbackEpoch);
      await partitionController.createPartitionsToProcessEpoch(nextEpoch);

      // Collect committee partitions created for the first partial UTC hour.
      const committeePartitions = createdPartitions
        .filter((partition) => partition.tableName === PARTITION_TABLE_NAMES.COMMITTEE)
        .map((partition) => parseSlotPartitionName(partition.partitionName));

      // Collect epoch_rewards partitions created for the first partial UTC hour.
      const epochRewardsPartitions = createdPartitions
        .filter((partition) => partition.tableName === PARTITION_TABLE_NAMES.EPOCH_REWARDS)
        .map((partition) => parseEpochPartitionName(partition.partitionName));

      // Confirm committee uses one consistent first-hour partition from lookback.
      expect(new Set(committeePartitions.map((partition) => partition?.start))).toEqual(
        new Set([lookbackSlot]),
      );
      expect(new Set(committeePartitions.map((partition) => partition?.end))).toEqual(
        new Set([14265298]),
      );

      // Confirm epoch_rewards uses one consistent first-hour partition from the lookback epoch.
      expect(new Set(epochRewardsPartitions.map((partition) => partition?.start))).toEqual(
        new Set([lookbackEpoch]),
      );
      expect(new Set(epochRewardsPartitions.map((partition) => partition?.end))).toEqual(
        new Set([445790]),
      );

      // Confirm both tables are paired by the same 18:00 UTC partition name hour.
      expect(
        new Set(committeePartitions.map((partition) => partition?.datetime?.toISOString())),
      ).toEqual(new Set(['2026-05-05T18:00:00.000Z']));
      expect(
        new Set(epochRewardsPartitions.map((partition) => partition?.datetime?.toISOString())),
      ).toEqual(new Set(['2026-05-05T18:00:00.000Z']));
    });

    it('creates adjacent Ethereum committee partitions without slot overlap at a UTC hour boundary', async () => {
      // Use the real Ethereum lookback slot that starts at 2026-05-05T18:00:11Z.
      const lookbackSlot = 14264999;

      // Process the epoch that crosses from the 18:00 UTC hour into the 19:00 UTC hour.
      const boundaryEpoch = 445790;

      // Build the controller with an in-memory storage mock.
      const { createdPartitions, partitionController } = createPartitionController(lookbackSlot);

      // Create the committee partitions needed for the boundary-crossing epoch.
      await partitionController.createPartitionForCommittee(boundaryEpoch);

      // Parse the created committee partitions so ranges and hour suffixes can be asserted.
      const committeePartitions = createdPartitions
        .filter((partition) => partition.tableName === PARTITION_TABLE_NAMES.COMMITTEE)
        .map((partition) => parseSlotPartitionName(partition.partitionName));

      // Confirm the boundary-crossing epoch creates the 18:00 and 19:00 hour partitions.
      expect(committeePartitions).toHaveLength(2);

      // Confirm adjacent slot ranges meet without sharing a slot.
      expect(committeePartitions[0]?.end).toBe(14265298);
      expect(committeePartitions[1]?.start).toBe(14265299);

      // Confirm the second partition is named for the 19:00 UTC hour.
      expect(committeePartitions[1]?.datetime?.toISOString()).toBe('2026-05-05T19:00:00.000Z');
    });
  });
});
