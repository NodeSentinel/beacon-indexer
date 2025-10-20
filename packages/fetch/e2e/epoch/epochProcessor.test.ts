import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

describe('Epoch Processor E2E Tests', () => {
  let prisma: PrismaClient;
  let epochStorage: EpochStorage;
  let validatorsStorage: ValidatorsStorage;
  let epochController: EpochController;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    validatorsStorage = new ValidatorsStorage(prisma);
    epochStorage = new EpochStorage(prisma, validatorsStorage);

    epochController = new EpochController(
      { slotStartIndexing: 32000 } as BeaconClient,
      epochStorage,
      validatorsStorage,
      new BeaconTime({
        genesisTimestamp: 1606824023,
        slotDurationMs: 12000,
        slotsPerEpoch: 32,
        epochsPerSyncCommitteePeriod: 256,
        slotStartIndexing: 32000,
      }),
    );

    await prisma.epoch.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Controller processing helpers', () => {
    beforeEach(async () => {
      await prisma.epoch.deleteMany();
    });

    it('getMaxEpoch: returns null when empty and max when data exists', async () => {
      const emptyMax = await epochController.getMaxEpoch();
      expect(emptyMax).toBeNull();

      await epochStorage.createEpochs([1000, 1001, 1002]);
      const max = await epochController.getMaxEpoch();
      expect(max).toBe(1002);
    });

    it('getMinEpochToProcess: returns the smallest unprocessed epoch', async () => {
      await epochStorage.createEpochs([1000, 1001, 1002]);

      const min1 = await epochController.getMinEpochToProcess();
      expect(min1?.epoch).toBe(1000);
      expect(min1?.processed).toBe(false);

      await epochController.markEpochAsProcessed(1000);
      const min2 = await epochController.getMinEpochToProcess();
      expect(min2?.epoch).toBe(1001);
      expect(min2?.processed).toBe(false);

      await epochController.markEpochAsProcessed(1001);
      await epochController.markEpochAsProcessed(1002);
      const min3 = await epochController.getMinEpochToProcess();
      expect(min3).toBeNull();
    });

    it('markEpochAsProcessed: updates processed flag and shifts next min', async () => {
      await epochStorage.createEpochs([2000, 2001, 2002]);

      let min = await epochController.getMinEpochToProcess();
      expect(min?.epoch).toBe(2000);

      await epochController.markEpochAsProcessed(2000);
      const updated = await epochController.getEpochByNumber(2000);
      expect(updated?.processed).toBe(true);

      min = await epochController.getMinEpochToProcess();
      expect(min?.epoch).toBe(2001);
      expect(min?.processed).toBe(false);
    });

    it('getUnprocessedCount: counts epochs with any pending work', async () => {
      await epochStorage.createEpochs([3000, 3001, 3002]);
      const count = await epochController.getUnprocessedCount();
      expect(count).toBe(3);
    });
  });
});
