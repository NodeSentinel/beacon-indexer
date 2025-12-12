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
  let beaconTimeWithLookback: BeaconTime;
  let epochControllerWithLookback: EpochController;

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

    // Create BeaconTime with lookbackSlot = 12000 (realistic production scenario)
    // Gnosis: 5 second slots, 16 slots per epoch = 80 seconds per epoch
    // 720 slots per hour (3600 seconds / 5 seconds per slot)
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Partition Creation Logic', () => {
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

      // Verify the partition is actually a child of committee table
      const inheritanceInfo = await prisma.$queryRaw<Array<{ parent: string }>>`
        SELECT inhparent::regclass::text as parent
        FROM pg_inherits
        WHERE inhrelid = ${partitionName}::regclass
      `;

      expect(inheritanceInfo).toHaveLength(1);
      expect(inheritanceInfo[0].parent).toBe('committee');
    });

    it('should create multiple partitions when epoch spans partition boundary', async () => {
      // Create a BeaconTime with lookbackSlot = 12010 to ensure epochs can cross partition boundaries
      // With lookbackSlot = 12010 and slotsPerHour = 720:
      // Partition 0: slots 12010-12729
      // Partition 1: slots 12730-13449
      // Epoch 795 has slots 12720-12735, which spans both partitions:
      //   - Slots 12720-12729 are in partition 0
      //   - Slots 12730-12735 are in partition 1
      const beaconTimeForBoundaryTest = new BeaconTime({
        genesisTimestamp: 1640995200000,
        slotDurationMs: 5000,
        slotsPerEpoch: 16,
        epochsPerSyncCommitteePeriod: 256,
        lookbackSlot: 12010,
      });

      const epochControllerForBoundaryTest = new EpochController(
        { slotStartIndexing: 12010 } as BeaconClient,
        epochStorage,
        validatorsStorage,
        beaconTimeForBoundaryTest,
      );

      // Epoch 795 crosses the partition boundary
      const epoch795 = 795;
      const { startSlot, endSlot } = beaconTimeForBoundaryTest.getEpochSlots(epoch795);

      // Verify this epoch actually spans the boundary
      const partitionStart = beaconTimeForBoundaryTest.getPartitionStartSlot(startSlot);
      const partitionEnd = beaconTimeForBoundaryTest.getPartitionStartSlot(endSlot);
      expect(partitionStart).not.toBe(partitionEnd); // Should be in different partitions

      // Process the epoch - this should create both partitions in a single call
      await epochControllerForBoundaryTest.upsertCommitteePartitions(epoch795);

      // Verify both partitions were created
      const partition0Start = beaconTimeForBoundaryTest.getPartitionStartSlot(startSlot);
      const partition1Start = beaconTimeForBoundaryTest.getPartitionStartSlot(endSlot);

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

      // Verify partition ranges are correct
      const partition0EndSlot = beaconTimeForBoundaryTest.getPartitionEndSlot(partition0Start);
      const partition1EndSlot = beaconTimeForBoundaryTest.getPartitionEndSlot(partition1Start);

      expect(partition0EndSlot).toBe(12729); // 12010 + 720 - 1
      expect(partition1EndSlot).toBe(13449); // 12730 + 720 - 1
    });

    it('should be idempotent - calling multiple times should not cause errors', async () => {
      const epoch = beaconTimeWithLookback.getEpochFromSlot(12000);

      // Call upsertCommitteePartitions multiple times
      await epochControllerWithLookback.upsertCommitteePartitions(epoch);
      await epochControllerWithLookback.upsertCommitteePartitions(epoch);
      await epochControllerWithLookback.upsertCommitteePartitions(epoch);

      // Verify partition still exists and no errors occurred
      const partitionStartSlot = beaconTimeWithLookback.getPartitionStartSlot(12000);
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
  });
});
