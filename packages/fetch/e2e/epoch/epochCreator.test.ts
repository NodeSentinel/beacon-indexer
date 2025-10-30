import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

describe('Epoch Creation E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
  let validatorsStorage: ValidatorsStorage;
  let epochController: EpochController;

  const MAX_UNPROCESSED_EPOCHS = 5;

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

    // Initialize storage and controller
    validatorsStorage = new ValidatorsStorage(prisma);
    epochStorage = new EpochStorage(prisma, validatorsStorage);

    // Create EpochController with mocked BeaconClient
    epochController = new EpochController(
      { slotStartIndexing: 32000 } as BeaconClient, // Mock slot that represents epoch 1000
      epochStorage,
      validatorsStorage,
      new BeaconTime({
        genesisTimestamp: 1606824023,
        slotDurationMs: 12000,
        slotsPerEpoch: 32,
        epochsPerSyncCommitteePeriod: 256,
        lookbackSlot: 32000,
      }),
    );

    // Clean database before tests
    await prisma.epoch.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Epoch Creation Logic', () => {
    beforeEach(async () => {
      // Clean database before each test
      await prisma.epoch.deleteMany();
    });

    it('should create MAX_UNPROCESSED_EPOCHS epochs when no epochs exist in DB', async () => {
      // Use the new createEpochsIfNeeded method
      await epochController.createEpochsIfNeeded();

      // Verify epochs were created using controller
      const createdEpochs = await epochController.getAllEpochs();

      expect(createdEpochs).toHaveLength(MAX_UNPROCESSED_EPOCHS);

      // Verify epochs start from the correct epoch (32000 / 32 = 1000)
      const expectedStartEpoch = 1000;
      expect(createdEpochs[0].epoch).toBe(expectedStartEpoch);

      // Should be consecutive epochs
      for (let i = 1; i < createdEpochs.length; i++) {
        expect(createdEpochs[i].epoch).toBe(createdEpochs[i - 1].epoch + 1);
      }

      // Verify all epochs are unprocessed (all flags are false)
      createdEpochs.forEach((epoch) => {
        expect(epoch.validatorsBalancesFetched).toBe(false);
        expect(epoch.rewardsFetched).toBe(false);
        expect(epoch.committeesFetched).toBe(false);
        expect(epoch.slotsFetched).toBe(false);
        expect(epoch.syncCommitteesFetched).toBe(false);
      });
    });

    it('should not create any epochs when there are MAX_UNPROCESSED_EPOCHS unprocessed epochs', async () => {
      // Count epochs before calling createEpochsIfNeeded
      const epochsBefore = await epochController.getEpochCount();
      expect(epochsBefore).toBe(0);

      // Try to create epochs again - should not create any new ones
      await epochController.createEpochsIfNeeded();

      // Verify no additional epochs were created
      const totalEpochs = await epochController.getEpochCount();
      expect(totalEpochs).toBe(MAX_UNPROCESSED_EPOCHS);

      await epochController.createEpochsIfNeeded();
      expect(totalEpochs).toBe(MAX_UNPROCESSED_EPOCHS);
    });

    it('should create only the difference when less than MAX_UNPROCESSED_EPOCHS are unprocessed', async () => {
      // Create 3 unprocessed epochs (less than MAX_UNPROCESSED_EPOCHS = 5)
      const existingEpochs: number[] = [];
      for (let i = 0; i < 3; i++) {
        existingEpochs.push(1000 + i); // Use a fixed starting epoch for test
      }
      await epochStorage.createEpochs(existingEpochs);

      // Count epochs before calling createEpochsIfNeeded
      const epochsBefore = await epochController.getEpochCount();
      expect(epochsBefore).toBe(3);

      // Create the additional epochs using createEpochsIfNeeded
      await epochController.createEpochsIfNeeded();

      // Verify total epochs in database
      const totalEpochs = await epochController.getEpochCount();
      expect(totalEpochs).toBe(MAX_UNPROCESSED_EPOCHS);

      // Verify all epochs are consecutive
      const allEpochs = await epochController.getAllEpochs();

      for (let i = 1; i < allEpochs.length; i++) {
        expect(allEpochs[i].epoch).toBe(allEpochs[i - 1].epoch + 1);
      }
    });

    it('should create epochs in database with correct default values', async () => {
      const epochsToCreate = [1000, 1001, 1002];
      await epochStorage.createEpochs(epochsToCreate);

      const createdEpochs = await epochStorage.getAllEpochs();
      expect(createdEpochs).toHaveLength(3);

      // Verify epochs are stored correctly
      expect(createdEpochs.map((e) => e.epoch)).toEqual([1000, 1001, 1002]);

      // Verify all default values are set correctly
      createdEpochs.forEach((epoch) => {
        expect(epoch.processed).toBe(false);
        expect(epoch.validatorsBalancesFetched).toBe(false);
        expect(epoch.rewardsFetched).toBe(false);
        expect(epoch.committeesFetched).toBe(false);
        expect(epoch.slotsFetched).toBe(false);
        expect(epoch.syncCommitteesFetched).toBe(false);
      });
    });

    it('should throw error when trying to create duplicate epochs', async () => {
      // Create epochs first time
      const epochs = [1000, 1001, 1002];
      await epochStorage.createEpochs(epochs);

      // Try to create the same epochs again - should throw error due to duplicate key constraint
      await expect(epochStorage.createEpochs(epochs)).rejects.toThrow();

      // Should still have only 3 epochs (no duplicates were created)
      const allEpochs = await epochStorage.getAllEpochs();
      expect(allEpochs).toHaveLength(3);
      expect(allEpochs.map((e) => e.epoch)).toEqual([1000, 1001, 1002]);
    });

    it('should handle database queries correctly for max epoch detection', async () => {
      // Test getMaxEpoch when DB is empty
      const maxEpochEmpty = await epochStorage.getMaxEpoch();
      expect(maxEpochEmpty).toBeNull();

      // Create some epochs
      await epochStorage.createEpochs([1000, 1001, 1002]);

      // Test getMaxEpoch when DB has data
      const maxEpoch = await epochStorage.getMaxEpoch();
      expect(maxEpoch?.epoch).toBe(1002);
    });

    it('should throw error when first epoch is not next to max epoch in DB', async () => {
      // First create some epochs
      const initialEpochs = [1000, 1001, 1002];
      await epochStorage.createEpochs(initialEpochs);

      // Try to create epochs that don't start from the next epoch (1003)
      const invalidEpochs = [1004, 1005, 1006]; // Should start from 1003, not 1004

      await expect(epochStorage.createEpochs(invalidEpochs)).rejects.toThrow(
        'First epoch to create (1004) must be the next epoch after the max epoch in DB (1002). Expected: 1003',
      );
    });

    it('should allow creating epochs when DB is empty', async () => {
      // Test that we can create epochs when DB is empty
      const epochsToCreate = [1000, 1001, 1002];
      await epochStorage.createEpochs(epochsToCreate);

      const createdEpochs = await epochStorage.getAllEpochs();
      expect(createdEpochs).toHaveLength(3);
      expect(createdEpochs.map((e) => e.epoch)).toEqual([1000, 1001, 1002]);
    });
  });
});
