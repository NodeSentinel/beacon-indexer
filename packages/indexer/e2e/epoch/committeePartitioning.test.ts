import { PrismaClient } from '@beacon-indexer/db';
import { addHours } from 'date-fns';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { BeaconTime } from '@/src/services/consensus/utils/beaconTime.js';

describe('Committee Partitioning E2E Tests', () => {
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

    partitionControllerWithLookback = new PartitionController(
      partitionStorage,
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
        WHERE tablename LIKE 'committee_%'
      `;

      for (const partition of partitions) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
      }
    });

    it('should create partition aligned to UTC hour boundary', async () => {
      // Epoch that contains lookbackSlot
      const epoch = beaconTimeWithLookback.getEpochFromSlot(12000);

      await partitionControllerWithLookback.createPartitionForCommittee(epoch);

      // Partition should start at the UTC hour boundary containing slot 12000
      const partitionStartSlot = beaconTimeWithLookback.getSlotAtStartOfUTCHourContaining(12000);

      // Calculate the end slot (start of next UTC hour)
      const startSlotTimestamp =
        beaconTimeWithLookback.getTimestampFromSlotNumber(partitionStartSlot);
      const nextHour = addHours(startSlotTimestamp, 1).getTime(); // next UTC hour start
      const nextHourSlot = beaconTimeWithLookback.getSlotNumberFromTimestamp(nextHour);
      const partitionEndSlot = nextHourSlot - 1; // we don't want to include the first slot of the next hour

      // Partition name format: committee_${startSlot}-${endSlot}
      const partitionName = `committee_${partitionStartSlot}-${partitionEndSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
        ) as exists
      `;

      expect(partitionExists[0]?.exists).toBe(true);

      // Verify partition has correct range [partitionStartSlot, nextHourSlot)
      const partitionInfo = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partitionName}
      `;

      expect(partitionInfo).toHaveLength(1);
      const expression = partitionInfo[0].partition_expression;
      expect(expression).toContain(partitionStartSlot.toString());
      expect(expression).toContain(nextHourSlot.toString()); // exclusive end

      // Verify the partition is actually a child of committee table
      const inheritanceInfo = await prisma.$queryRaw<Array<{ parent: string }>>`
        SELECT inhparent::regclass::text as parent
        FROM pg_inherits
        WHERE inhrelid = ${partitionName}::regclass
      `;

      expect(inheritanceInfo).toHaveLength(1);
      expect(inheritanceInfo[0].parent).toBe('committee');
    });

    it('should create multiple partitions when epoch spans UTC hour boundary', async () => {
      // Use Gnosis chain configuration with epoch 1586253 which crosses UTC hour boundary
      // Epoch 1586253: slots 25380048-25380063 (2025-12-16T13:59:40Z to 14:00:55Z)
      // This epoch crosses from 13:00 UTC hour to 14:00 UTC hour
      const gnosisGenesisTimestamp = 1638993340000; // Gnosis genesis: 1638993340s
      const lookbackSlot = 25380000; // Before the epoch start slot

      const beaconTimeForBoundaryTest = new BeaconTime({
        genesisTimestamp: gnosisGenesisTimestamp,
        slotDurationMs: 5000,
        slotsPerEpoch: 16,
        epochsPerSyncCommitteePeriod: 256,
        lookbackSlot: lookbackSlot,
      });

      const partitionControllerForBoundaryTest = new PartitionController(
        partitionStorage,
        beaconTimeForBoundaryTest,
      );

      // Epoch 1586253 crosses UTC hour boundary
      const epoch1586253 = 1586253;
      const { startSlot, endSlot } = beaconTimeForBoundaryTest.getEpochSlots(epoch1586253);

      // Verify this epoch actually spans UTC hour boundary
      const partitionOneStart = beaconTimeForBoundaryTest.getSlotAtStartOfUTCHourContaining(
        Math.max(startSlot, beaconTimeForBoundaryTest.getLookbackSlot()),
      );
      const partitionTwoStart =
        beaconTimeForBoundaryTest.getSlotAtStartOfUTCHourContaining(endSlot);
      expect(partitionOneStart).not.toBe(partitionTwoStart); // Should be in different UTC hours

      // Process the epoch - this should create both partitions in a single call
      await partitionControllerForBoundaryTest.createPartitionForCommittee(epoch1586253);

      // Calculate partition names based on UTC hour boundaries
      const startSlotTimestamp0 =
        beaconTimeForBoundaryTest.getTimestampFromSlotNumber(partitionOneStart);
      const nextHour0 = addHours(startSlotTimestamp0, 1).getTime();
      const nextHourSlot0 = beaconTimeForBoundaryTest.getSlotNumberFromTimestamp(nextHour0);
      const partition0EndSlot = nextHourSlot0 - 1; // we don't want to include the first slot of the next hour

      const startSlotTimestamp1 =
        beaconTimeForBoundaryTest.getTimestampFromSlotNumber(partitionTwoStart);
      const nextHour1 = addHours(startSlotTimestamp1, 1).getTime();
      const nextHourSlot1 = beaconTimeForBoundaryTest.getSlotNumberFromTimestamp(nextHour1);
      const partition1EndSlot = nextHourSlot1 - 1;

      const partition0Name = `committee_${partitionOneStart}-${partition0EndSlot}`;
      const partition1Name = `committee_${partitionTwoStart}-${partition1EndSlot}`;

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

      // Verify partition ranges are correct (exclusive end in PostgreSQL)
      const partition0Info = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partition0Name}
      `;

      const partition1Info = await prisma.$queryRaw<Array<{ partition_expression: string }>>`
        SELECT pg_get_expr(c.relpartbound, c.oid) as partition_expression
        FROM pg_class c
        WHERE c.relname = ${partition1Name}
      `;

      expect(partition0Info[0].partition_expression).toContain(partitionOneStart.toString());
      expect(partition0Info[0].partition_expression).toContain(nextHourSlot0.toString());
      expect(partition1Info[0].partition_expression).toContain(partitionTwoStart.toString());
      expect(partition1Info[0].partition_expression).toContain(nextHourSlot1.toString());
    });

    it('should be idempotent - calling multiple times should not cause errors', async () => {
      const epoch = beaconTimeWithLookback.getEpochFromSlot(12000);

      // Call createPartitionForCommittee multiple times
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);
      await partitionControllerWithLookback.createPartitionForCommittee(epoch);

      // Verify partition still exists and no errors occurred
      const partitionStartSlot = beaconTimeWithLookback.getSlotAtStartOfUTCHourContaining(12000);
      const startSlotTimestamp =
        beaconTimeWithLookback.getTimestampFromSlotNumber(partitionStartSlot);
      const nextHour = addHours(startSlotTimestamp, 1).getTime();
      const nextHourSlot = beaconTimeWithLookback.getSlotNumberFromTimestamp(nextHour);
      const partitionEndSlot = nextHourSlot - 1;
      const partitionName = `committee_${partitionStartSlot}-${partitionEndSlot}`;

      const partitionExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class
          WHERE relname = ${partitionName}
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
});
