import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/beaconTime.js';

describe('Committee Partitioning E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
  let validatorsStorage: ValidatorsStorage;
  let epochController: EpochController;
  let beaconTime: BeaconTime;

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

    // Initialize storage
    validatorsStorage = new ValidatorsStorage(prisma);
    epochStorage = new EpochStorage(prisma, validatorsStorage);

    // Create BeaconTime instance with realistic Gnosis Chain parameters
    // Gnosis: 5 second slots, 16 slots per epoch = 80 seconds per epoch
    // 720 slots per hour (3600 seconds / 5 seconds per slot)
    // This means epochs will span different partitions more frequently
    beaconTime = new BeaconTime({
      genesisTimestamp: 1640995200000, // Jan 1, 2022 00:00:00 UTC (aligned to hour)
      slotDurationMs: 5000, // 5 seconds
      slotsPerEpoch: 16,
      epochsPerSyncCommitteePeriod: 256,
      lookbackSlot: 0,
    });

    // Create EpochController
    epochController = new EpochController(
      { slotStartIndexing: 0 } as BeaconClient,
      epochStorage,
      validatorsStorage,
      beaconTime,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Partition Creation Logic', () => {
    beforeEach(async () => {
      // Clean up partitions before each test
      // Drop all committee partitions (this is safe in test environment)
      const partitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
      `;

      for (const partition of partitions) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${partition.tablename}`);
      }
    });

    it('should create partition for epoch that spans a single partition', async () => {
      // Use epoch that stays within the same partition
      // Epoch 0: slots 0-15, all within the same partition (first 720 slots)
      const epoch = 0;
      const { startSlot } = beaconTime.getEpochSlots(epoch);

      await epochController.upsertCommitteePartitions(epoch);

      // Verify partition was created
      const partitionStartSlot = beaconTime.getPartitionStartSlot(startSlot);
      const partitionName = `committee_slot_${partitionStartSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify only one partition was created
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
      `;

      expect(allPartitions).toHaveLength(1);
      expect(allPartitions[0].tablename).toBe(partitionName);
    });

    it('should create two partitions when processing epochs that span partition boundary', async () => {
      // Epoch 44: slots 704-719 (last epoch in partition 0)
      // Epoch 45: slots 720-735 (first epoch in partition 1)
      // Processing both epochs should create both partitions
      const epoch44 = 44;
      const epoch45 = 45;

      // Verify epochs are in different partitions
      const { startSlot: start44 } = beaconTime.getEpochSlots(epoch44);
      const { startSlot: start45 } = beaconTime.getEpochSlots(epoch45);
      const partitionStart44 = beaconTime.getPartitionStartSlot(start44);
      const partitionStart45 = beaconTime.getPartitionStartSlot(start45);
      expect(partitionStart44).not.toBe(partitionStart45);

      // Process both epochs
      await epochController.upsertCommitteePartitions(epoch44);
      await epochController.upsertCommitteePartitions(epoch45);

      const partition1Name = 'committee_slot_0';
      const partition2Name = 'committee_slot_720';

      const partition1Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partition1Name}
        ) as exists
      `;

      const partition2Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partition2Name}
        ) as exists
      `;

      expect(partition1Exists[0]?.exists).toBe(true);
      expect(partition2Exists[0]?.exists).toBe(true);

      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
        ORDER BY tablename
      `;

      expect(allPartitions).toHaveLength(2);
      expect(allPartitions[0].tablename).toBe(partition1Name);
      expect(allPartitions[1].tablename).toBe(partition2Name);
    });

    it('should be idempotent - calling multiple times should not cause errors', async () => {
      const epoch = 0;

      // Call upsertCommitteePartitions multiple times
      await epochController.upsertCommitteePartitions(epoch);
      await epochController.upsertCommitteePartitions(epoch);
      await epochController.upsertCommitteePartitions(epoch);

      // Verify partition still exists and no errors occurred
      const partitionStartSlot = beaconTime.getPartitionStartSlot(0);
      const partitionName = `committee_slot_${partitionStartSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify still only one partition exists
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
      `;

      expect(allPartitions).toHaveLength(1);
    });

    it('should create partitions with correct slot ranges', async () => {
      const epoch = 0;
      const { startSlot } = beaconTime.getEpochSlots(epoch);
      const partitionStartSlot = beaconTime.getPartitionStartSlot(startSlot);
      const expectedPartitionEndSlot = beaconTime.getPartitionEndSlot(partitionStartSlot);

      await epochController.upsertCommitteePartitions(epoch);

      // Query partition bounds from PostgreSQL
      const partitionName = `committee_slot_${partitionStartSlot}`;
      const partitionInfo = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partitionName}
      `;

      expect(partitionInfo).toHaveLength(1);

      // PostgreSQL partition expression format: FOR VALUES FROM (start) TO (end)
      // The expression should contain our slot range
      const expression = partitionInfo[0].partition_expression;
      expect(expression).toContain(partitionStartSlot.toString());
      expect(expression).toContain((expectedPartitionEndSlot + 1).toString()); // +1 because TO is exclusive
    });

    it('should handle multiple epochs creating overlapping partitions', async () => {
      // Create partitions for multiple consecutive epochs
      // Some might share the same partition
      const epoch1 = 0;
      const epoch2 = 1;
      const epoch3 = 2;

      await epochController.upsertCommitteePartitions(epoch1);
      await epochController.upsertCommitteePartitions(epoch2);
      await epochController.upsertCommitteePartitions(epoch3);

      // All three epochs are likely in the same partition (first partition: slots 0-719)
      // So we should have only one partition
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
      `;

      // Should have at least 1 partition, possibly 2 if epochs span partition boundary
      expect(allPartitions.length).toBeGreaterThanOrEqual(1);
      expect(allPartitions.length).toBeLessThanOrEqual(2);
    });

    it('should create partition that is actually a child of committee table', async () => {
      const epoch = 0;
      await epochController.upsertCommitteePartitions(epoch);

      const partitionStartSlot = beaconTime.getPartitionStartSlot(0);
      const partitionName = `committee_slot_${partitionStartSlot}`;

      // Verify the partition is actually a partition of the committee table
      const inheritanceInfo = await prisma.$queryRaw<Array<{ parent: string }>>`
        SELECT inhparent::regclass::text as parent
        FROM pg_inherits
        WHERE inhrelid = ${partitionName}::regclass
      `;

      expect(inheritanceInfo).toHaveLength(1);
      expect(inheritanceInfo[0].parent).toBe('committee');
    });
  });

  describe('Partition alignment with lookbackSlot > 0', () => {
    let beaconTimeWithLookback: BeaconTime;
    let epochControllerWithLookback: EpochController;

    beforeAll(() => {
      // Create BeaconTime with lookbackSlot = 12000
      beaconTimeWithLookback = new BeaconTime({
        genesisTimestamp: 1640995200000,
        slotDurationMs: 5000,
        slotsPerEpoch: 16,
        epochsPerSyncCommitteePeriod: 256,
        lookbackSlot: 12000,
      });

      epochControllerWithLookback = new EpochController(
        { slotStartIndexing: 12000 } as BeaconClient,
        epochStorage,
        validatorsStorage,
        beaconTimeWithLookback,
      );
    });

    beforeEach(async () => {
      // Clean up partitions before each test
      const partitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
      `;

      for (const partition of partitions) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${partition.tablename}`);
      }
    });

    it('should create partition starting at lookbackSlot', async () => {
      // Epoch that contains lookbackSlot
      // Calculate epoch that contains slot 12000
      const epoch = beaconTimeWithLookback.getEpochFromSlot(12000);

      await epochControllerWithLookback.upsertCommitteePartitions(epoch);

      // Partition should start at 12000
      const partitionStartSlot = beaconTimeWithLookback.getPartitionStartSlot(12000);
      expect(partitionStartSlot).toBe(12000);

      const partitionName = `committee_slot_${partitionStartSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify partition has correct range [12000, 12720)
      const partitionEndSlot = beaconTimeWithLookback.getPartitionEndSlot(partitionStartSlot);
      expect(partitionEndSlot).toBe(12719); // 12000 + 720 - 1

      const partitionInfo = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partitionName}
      `;

      expect(partitionInfo).toHaveLength(1);
      const expression = partitionInfo[0].partition_expression;
      expect(expression).toContain('12000');
      expect(expression).toContain('12720'); // endSlot + 1 = 12719 + 1 = 12720
    });

    it('should create next partition at lookbackSlot + slotsPerHour', async () => {
      // Test that partition 1 starts at 12720 (12000 + 720)
      // Process an epoch that spans into the second partition
      const epochAtPartitionBoundary = beaconTimeWithLookback.getEpochFromSlot(12720);

      await epochControllerWithLookback.upsertCommitteePartitions(epochAtPartitionBoundary);

      // Verify both partitions exist
      const partition0Start = beaconTimeWithLookback.getPartitionStartSlot(12000);
      const partition1Start = beaconTimeWithLookback.getPartitionStartSlot(12720);

      expect(partition0Start).toBe(12000);
      expect(partition1Start).toBe(12720);

      const partition0Name = `committee_slot_${partition0Start}`;
      const partition1Name = `committee_slot_${partition1Start}`;

      const partition0Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partition0Name}
        ) as exists
      `;

      const partition1Exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partition1Name}
        ) as exists
      `;

      expect(partition0Exists[0]?.exists).toBe(true);
      expect(partition1Exists[0]?.exists).toBe(true);

      // Verify partition 1 has correct range [12720, 13440)
      const partition1EndSlot = beaconTimeWithLookback.getPartitionEndSlot(partition1Start);
      expect(partition1EndSlot).toBe(13439); // 12720 + 720 - 1

      const partition1Info = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partition1Name}
      `;

      expect(partition1Info).toHaveLength(1);
      const expression = partition1Info[0].partition_expression;
      expect(expression).toContain('12720');
      expect(expression).toContain('13440'); // endSlot + 1 = 13439 + 1 = 13440
    });

    it('should handle epoch that starts before lookbackSlot but ends after it', async () => {
      // This test verifies that if an epoch starts before lookbackSlot but ends after it,
      // we only create the partition that contains lookbackSlot and beyond
      const { startSlot, endSlot } = beaconTimeWithLookback.getEpochSlots(
        beaconTimeWithLookback.getEpochFromSlot(11900),
      );

      // Verify startSlot < lookbackSlot but endSlot >= lookbackSlot
      expect(startSlot).toBeLessThan(12000);
      expect(endSlot).toBeGreaterThanOrEqual(12000);

      await epochControllerWithLookback.upsertCommitteePartitions(
        beaconTimeWithLookback.getEpochFromSlot(11900),
      );

      // Should only create partition starting at lookbackSlot (12000)
      const partitionStartSlot = beaconTimeWithLookback.getPartitionStartSlot(12000);
      expect(partitionStartSlot).toBe(12000);

      const partitionName = `committee_slot_${partitionStartSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify no partition was created for slots before lookbackSlot
      const allPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename 
        FROM pg_tables 
        WHERE tablename LIKE 'committee_slot_%'
        ORDER BY tablename
      `;

      // Should have exactly one partition (the one starting at 12000)
      expect(allPartitions).toHaveLength(1);
      expect(allPartitions[0].tablename).toBe(partitionName);
    });
  });
});
