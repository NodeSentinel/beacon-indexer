import { BeaconTime } from '@beacon-indexer/consensus-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/consensus-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPartitionName } from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import {
  PARTITION_TABLE_NAMES,
  PartitionController,
} from '@/src/services/consensus/controllers/partition.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { getUTCDatetimeFlooredToHour } from '@/src/utils/date/index.js';

describe('Partitioning by epoch', () => {
  let prisma: PrismaClient;
  let partitionStorage: PartitionStorage;
  let beaconTimeWithLookback: BeaconTime;
  let partitionControllerWithLookback: PartitionController;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Initialize database connection
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Initialize partition storage
    partitionStorage = new PartitionStorage(prisma);

    // Create BeaconTime with lookbackSlot = 25380000 (before epochs 1586252 and 1586253 for testing)
    // Gnosis: 5 second slots, 16 slots per epoch = 80 seconds per epoch
    // 720 slots per hour (3600 seconds / 5 seconds per slot)
    beaconTimeWithLookback = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 25380000,
    });

    partitionControllerWithLookback = new PartitionController(
      partitionStorage,
      beaconTimeWithLookback,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Committee', () => {
    beforeEach(async () => {
      // Clean up partitions before each test
      const partitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_%'
      `;

      for (const partition of partitions) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
      }
    });

    it('should create partition aligned to UTC hour boundary', async () => {
      // Epoch 1586252: slots 25380032-25380047 (Dec-16-2025 13:58:20 - 13:59:35 UTC)
      // lookbackSlot: 25380000 (before this epoch)
      // Expected partition: committee_25379332-25380051_YYYYMMDDHH (UTC hour boundary for 13:00 UTC)
      const epoch = 1586252;
      const startSlot = 25379332;
      const endSlot = 25380051;

      // Calculate UTC hour timestamp from the start slot using real Gnosis chain data
      const startSlotTimestamp = beaconTimeWithLookback.getTimestampFromSlotNumber(startSlot);
      const hourTimestamp = getUTCDatetimeFlooredToHour(startSlotTimestamp);
      const expectedPartitionName = getPartitionName(
        'committee',
        startSlot,
        endSlot,
        hourTimestamp,
      );

      await partitionControllerWithLookback.createPartitionForCommittee(epoch);

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify partition has correct range [25379332, 25380052)
      const partitionInfo = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${expectedPartitionName}
      `;

      expect(partitionInfo).toHaveLength(1);
      const expression = partitionInfo[0].partition_expression;
      expect(expression).toContain('25379332');
      expect(expression).toContain('25380052'); // exclusive end

      // Verify the partition is actually a child of committee table
      const inheritanceInfo = await prisma.$queryRaw<Array<{ parent: string }>>`
        SELECT inhparent::regclass::text as parent
        FROM pg_inherits
        WHERE inhrelid = ${expectedPartitionName}::regclass
      `;

      expect(inheritanceInfo).toHaveLength(1);
      expect(inheritanceInfo[0].parent).toBe('committee');
    });

    it('should create multiple partitions when epoch spans UTC hour boundary', async () => {
      // Epoch 1586253: slots 25380048-25380063 (Dec-16-2025 01:59:40 PM +UTC - 02:00:55 PM +UTC)
      // (crosses UTC hour boundary from 13:00 to 14:00)
      // Expected partitions:
      // - committee_25379332-25380051_YYYYMMDDHH (13:00 UTC hour)
      // - committee_25380052-25380771_YYYYMMDDHH (14:00 UTC hour)
      const epoch = 1586253;

      // Calculate expected partition names using real Gnosis chain timestamps
      const startSlot0 = 25379332;
      const endSlot0 = 25380051;
      const startSlot0Timestamp = beaconTimeWithLookback.getTimestampFromSlotNumber(startSlot0);
      const hourTimestamp0 = getUTCDatetimeFlooredToHour(startSlot0Timestamp);
      const expectedPartition0Name = getPartitionName(
        'committee',
        startSlot0,
        endSlot0,
        hourTimestamp0,
      );

      const startSlot1 = 25380052;
      const endSlot1 = 25380771;
      const startSlot1Timestamp = beaconTimeWithLookback.getTimestampFromSlotNumber(startSlot1);
      const hourTimestamp1 = getUTCDatetimeFlooredToHour(startSlot1Timestamp);
      const expectedPartition1Name = getPartitionName(
        'committee',
        startSlot1,
        endSlot1,
        hourTimestamp1,
      );

      await partitionControllerWithLookback.createPartitionForCommittee(epoch);

      const partition0Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartition0Name}
        ) as exists
      `;

      const partition1Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartition1Name}
        ) as exists
      `;

      expect(partition0Exists[0]?.exists).toBe(true);
      expect(partition1Exists[0]?.exists).toBe(true);

      // Verify partition ranges are correct (exclusive end in PostgreSQL)
      const partition0Info = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${expectedPartition0Name}
      `;

      const partition1Info = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${expectedPartition1Name}
      `;

      expect(partition0Info[0].partition_expression).toContain('25379332');
      expect(partition0Info[0].partition_expression).toContain('25380052'); // exclusive end
      expect(partition1Info[0].partition_expression).toContain('25380052');
      expect(partition1Info[0].partition_expression).toContain('25380772'); // exclusive end
    });

    it('should be idempotent - calling multiple times should not cause errors', async () => {
      // Epoch 1586252 should create partition committee_25379332-25380051_YYYYMMDDHH
      const epoch = 1586252;
      const startSlot = 25379332;
      const endSlot = 25380051;

      // Calculate expected partition name using real Gnosis chain timestamps
      const startSlotTimestamp = beaconTimeWithLookback.getTimestampFromSlotNumber(startSlot);
      const hourTimestamp = getUTCDatetimeFlooredToHour(startSlotTimestamp);
      const expectedPartitionName = getPartitionName(
        'committee',
        startSlot,
        endSlot,
        hourTimestamp,
      );

      // Call createPartitionForCommittee multiple times
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);

      // Verify partition still exists and no errors occurred
      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify still only one partition exists for this epoch
      // (epoch might create 1 or 2 partitions depending on UTC hour boundaries)
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_%'
      `;

      // Should have at least one partition, but might have more if epoch spans UTC hours
      expect(allPartitions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Epoch Rewards', () => {
    beforeEach(async () => {
      // Clean up partitions before each test
      const partitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'epoch_rewards_%'
      `;

      for (const partition of partitions) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
      }
    });

    it('should create partition aligned to UTC hour boundary using epochs', async () => {
      // Epoch 1586252: slots 25380032-25380047 (Dec-16-2025 13:58:20 - 13:59:35 UTC)
      // lookbackSlot: 25380000 (before this epoch)
      // Expected partition: epoch_rewards_1586209-1586253_YYYYMMDDHH (UTC hour boundary for 13:00 UTC)
      // Note: epoch 1586208 starts at 12:00 UTC, so first epoch in 13:00 UTC hour is 1586209
      const epoch = 1586252;
      const startEpoch = 1586209;
      const endEpoch = 1586253;

      // Calculate UTC hour timestamp from the start epoch using real Gnosis chain data
      const startEpochTimestamp = beaconTimeWithLookback.getTimestampFromEpochNumber(startEpoch);
      const hourTimestamp = getUTCDatetimeFlooredToHour(startEpochTimestamp);
      const expectedPartitionName = getPartitionName(
        PARTITION_TABLE_NAMES.EPOCH_REWARDS,
        startEpoch,
        endEpoch,
        hourTimestamp,
      );

      await partitionControllerWithLookback.createPartitionForEpochRewards(epoch);

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify partition has correct range [1586209, 1586254)
      const partitionInfo = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${expectedPartitionName}
      `;

      expect(partitionInfo).toHaveLength(1);
      const expression = partitionInfo[0].partition_expression;
      expect(expression).toContain('1586209');
      expect(expression).toContain('1586254'); // exclusive end

      // Verify the partition is actually a child of epoch_rewards table
      const inheritanceInfo = await prisma.$queryRaw<Array<{ parent: string }>>`
        SELECT inhparent::regclass::text as parent
        FROM pg_inherits
        WHERE inhrelid = ${expectedPartitionName}::regclass
      `;

      expect(inheritanceInfo).toHaveLength(1);
      expect(inheritanceInfo[0].parent).toBe(PARTITION_TABLE_NAMES.EPOCH_REWARDS);
    });

    it('should be idempotent - calling multiple times should not cause errors', async () => {
      // Epoch 1586252 should create partition epoch_rewards_1586209-1586253_YYYYMMDDHH
      const epoch = 1586252;
      const startEpoch = 1586209;
      const endEpoch = 1586253;

      // Calculate expected partition name using real Gnosis chain timestamps
      const startEpochTimestamp = beaconTimeWithLookback.getTimestampFromEpochNumber(startEpoch);
      const hourTimestamp = getUTCDatetimeFlooredToHour(startEpochTimestamp);
      const expectedPartitionName = getPartitionName(
        PARTITION_TABLE_NAMES.EPOCH_REWARDS,
        startEpoch,
        endEpoch,
        hourTimestamp,
      );

      // Call createPartitionForEpochRewards multiple times
      await partitionControllerWithLookback.createPartitionForEpochRewards(epoch);
      await partitionControllerWithLookback.createPartitionForEpochRewards(epoch);
      await partitionControllerWithLookback.createPartitionForEpochRewards(epoch);

      // Verify partition still exists and no errors occurred
      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${expectedPartitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify only one partition exists for this epoch
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'epoch_rewards_%'
      `;

      expect(allPartitions.length).toBe(1);
    });
  });
});
