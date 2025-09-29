import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { BeaconClient } from '../../services/consensus/beacon.js';
import { EpochController } from '../../services/consensus/controllers/epoch.js';
import { EpochStorage } from '../../services/consensus/storage/epoch.js';
import { getEpochFromSlot } from '../../services/consensus/utils/misc.js';

describe('Epoch Creation E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
  let epochController: EpochController;
  let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'>;

  // Mock slotStartIndexing value for testing
  const MOCK_SLOT_START_INDEXING = 1000000;
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

    // Mock BeaconClient with slotStartIndexing
    mockBeaconClient = {
      slotStartIndexing: MOCK_SLOT_START_INDEXING,
    };

    epochController = new EpochController(mockBeaconClient as BeaconClient, epochStorage);

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
      const expectedStartEpoch = getEpochFromSlot(MOCK_SLOT_START_INDEXING);

      // Use the new createEpochsIfNeeded method
      await epochController.createEpochsIfNeeded();

      // Verify epochs were created using controller
      const createdEpochs = await epochController.getAllEpochs();

      expect(createdEpochs).toHaveLength(MAX_UNPROCESSED_EPOCHS);
      // Should be consecutive epochs starting from expectedStartEpoch
      for (let i = 0; i < createdEpochs.length; i++) {
        expect(createdEpochs[i].epoch).toBe(expectedStartEpoch + i);
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
      const startEpoch = getEpochFromSlot(MOCK_SLOT_START_INDEXING);

      // Create 3 unprocessed epochs (less than MAX_UNPROCESSED_EPOCHS = 5)
      const existingEpochs: number[] = [];
      for (let i = 0; i < 3; i++) {
        existingEpochs.push(startEpoch + i);
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
