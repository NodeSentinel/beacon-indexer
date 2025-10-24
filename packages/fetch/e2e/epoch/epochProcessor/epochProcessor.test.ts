import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import rewardsAttestations1525790 from './mocks/rewardsAttestations_1525790.json' with { type: 'json' };
import rewardsAttestations1525791 from './mocks/rewardsAttestations_1525791.json' with { type: 'json' };
import validatorsData from './mocks/validators.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorControllerHelpers } from '@/src/services/consensus/controllers/helpers/validatorControllerHelpers.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

/**
 * Note: Mocked data from this tests was taken from Gnosis chain.
 */
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
        genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
        slotDurationMs: gnosisConfig.beacon.slotDuration,
        slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
        slotStartIndexing: 32000,
      }),
    );

    await prisma.epoch.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Controller helpers', () => {
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

    // /eth/v1/beacon/rewards/attestations/1525790
    // /eth/v1/beacon/states/24412640/validators
    // ["549417","549418","549419","549046"]
  });

  describe('fetchEpochRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getAttestationRewards: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.hourlyValidatorData.deleteMany();
      await prisma.validator.deleteMany();
      await prisma.epoch.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getAttestationRewards: vi.fn(),
      };

      // Create epoch controller with mock
      epochControllerWithMock = new EpochController(
        mockBeaconClient as unknown as BeaconClient,
        epochStorage,
        validatorsStorage,
        new BeaconTime({
          genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
          slotDurationMs: gnosisConfig.beacon.slotDuration,
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
          epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
          slotStartIndexing: 32000,
        }),
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(v),
      );
      await validatorsStorage.saveValidators(validators);

      // Create epochs
      await epochStorage.createEpochs([1525790, 1525791, 1525792, 1525793]);
    });

    it('should process both epochs and verify HourlyValidatorData and HourlyValidatorStats', async () => {
      // Process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewardsFetched).toBe(true);

      // Process epoch 1525791
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525791?.rewardsFetched).toBe(true);

      // Expected datetime for both epochs (should be 2025-10-21T14:00:00.000Z)
      const expectedDatetime = new Date('2025-10-21T14:00:00.000Z');

      // Fetch validators data and stas from  database
      const validatorIndexes = [549417, 549418, 549419];
      const dbHourlyData = await prisma.hourlyValidatorData.findMany({
        where: {
          validatorIndex: { in: validatorIndexes },
        },
      });
      const dbHourlyStats = await prisma.hourlyValidatorStats.findMany({
        where: {
          validatorIndex: { in: validatorIndexes },
        },
      });

      // ===== VALIDATE HOURLY DATA =====
      expect(dbHourlyData.length).toBeGreaterThan(0);

      // Verify validator 549417
      const data549417 = dbHourlyData.find((d) => d.validatorIndex === 549417);
      expect(data549417!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549417!.epochRewards).toBe(
        '1525790:87524:163524:87929:0:0:0:0:0,1525791:87314:163553:87978:0:0:0:0:0',
      );

      // Verify validator 549418
      const data549418 = dbHourlyData.find((d) => d.validatorIndex === 549418);
      expect(data549418!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549418!.epochRewards).toBe(
        '1525790:87524:163524:87929:0:0:0:0:0,1525791:87314:163553:87978:0:0:0:0:0',
      );

      // Verify validator 549419
      const data549419 = dbHourlyData.find((d) => d.validatorIndex === 549419);
      expect(data549419!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      expect(data549419!.epochRewards).toBe(
        '1525790:37711:70458:37886:0:0:0:0:0,1525791:37621:70470:37907:0:0:0:0:0',
      );

      // ===== VALIDATE HOURLY STATS =====
      expect(dbHourlyStats.length).toBeGreaterThan(0);

      // Verify validator 549417 stats
      const stats549417 = dbHourlyStats.find((s) => s.validatorIndex === 549417);
      expect(stats549417!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549417 rewards (87524+163524+87929+0) + (87314+163553+87978+0) = 338977 + 338845 = 677822
      expect(Number(stats549417!.clRewards?.toString())).toBe(677822);

      // Verify validator 549418 stats
      const stats549418 = dbHourlyStats.find((s) => s.validatorIndex === 549418);
      expect(stats549418!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549418 rewards (same as 549417)
      expect(Number(stats549418!.clRewards?.toString())).toBe(677822);

      // Verify validator 549419 stats
      const stats549419 = dbHourlyStats.find((s) => s.validatorIndex === 549419);
      expect(stats549419!.datetime.toISOString()).toBe(expectedDatetime.toISOString());
      // Verify validator 549419 rewards (37711+70458+37886+0) + (37621+70470+37907+0) = 146055 + 145998 = 292053
      expect(Number(stats549419!.clRewards?.toString())).toBe(292053);
    });
  });
});
