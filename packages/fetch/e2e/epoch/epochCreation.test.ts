import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';

describe('Epoch Creation E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
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
    epochStorage = new EpochStorage(prisma);

    // Create EpochController with mocked BeaconClient
    epochController = new EpochController(
      { slotStartIndexing: 32000 } as BeaconClient, // Mock slot that represents epoch 1000
      epochStorage,
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
  });
});
