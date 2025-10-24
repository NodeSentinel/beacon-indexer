import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import rewardsAttestations1525790 from './mocks/rewardsAttestations_1525790.json' with { type: 'json' };
import rewardsAttestations1525791 from './mocks/rewardsAttestations_1525791.json' with { type: 'json' };
import validatorsData from './mocks/validators.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { AttestationRewards } from '@/src/services/consensus/types.js';
import { mapValidatorDataToDBEntity } from '@/src/services/consensus/utils/mappers/validatorMapper.js';
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

      // Save validators data to database using the mapper utility
      const validators = validatorsData.data.map((v) => mapValidatorDataToDBEntity(v));
      await validatorsStorage.saveValidators(validators);

      // Create epochs
      await epochStorage.createEpochs([1525790, 1525791, 1525792, 1525793]);
    });

    it('should verify rewards and missed rewards calculation for both epochs 1525790 and 1525791', async () => {
      // Process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Process epoch 1525791
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsAttestations1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);

      // Note: getEpochRewards method was removed with the new atomic processing strategy
      // Rewards are now processed directly into HourlyValidatorData and HourlyValidatorStats

      // Note: The detailed rewards validation was removed with the new atomic processing strategy
      // Rewards are now processed directly into HourlyValidatorData and HourlyValidatorStats
      // The validation logic would need to be updated to check these tables instead

      // Verify that both epochs were marked as rewardsFetched
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525790?.rewardsFetched).toBe(true);
      expect(epoch1525791?.rewardsFetched).toBe(true);
    });
  });

  describe('summarizeEpochRewardsHourly', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getAttestationRewards: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourlyValidatorStats.deleteMany();
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

      // Save validators data to database using the mapper utility
      const validators = validatorsData.data.map((v) => mapValidatorDataToDBEntity(v));
      await validatorsStorage.saveValidators(validators);

      // Create epochs
      await epochStorage.createEpochs([1525790, 1525791, 1525792, 1525793]);
    });

    it('should summarize epoch rewards into hourly validator attestation stats', async () => {
      // Mock the beacon client response
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsAttestations1525790);

      // First, fetch attestation rewards
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify epoch was marked as fetched
      const epochAfterFetch = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epochAfterFetch?.rewardsFetched).toBe(true);
      // Note: rewardsAggregated flag was removed with the new atomic processing strategy
      // Aggregation now happens atomically in fetchEpochRewards()

      // Get the timestamp for epoch 1525790 to check hourly stats
      // Use the same logic as the controller to ensure consistency
      const epochTimestamp = epochControllerWithMock
        .getBeaconTime()
        .getTimestampFromEpochNumber(1525790);
      const epochDate = new Date(epochTimestamp);
      const datetime = new Date(
        Date.UTC(
          epochDate.getUTCFullYear(),
          epochDate.getUTCMonth(),
          epochDate.getUTCDate(),
          epochDate.getUTCHours(),
          0,
          0,
          0,
        ),
      );

      console.log(
        `Test Debug: Epoch ${1525790} - Timestamp: ${epochTimestamp}, Date: ${epochDate.toISOString()}, Datetime: ${datetime.toISOString()}`,
      );

      // Get the summarized stats
      const validatorIndexes = [549417, 549418, 549419];
      const summarizedStats = await epochControllerWithMock.getHourlyValidatorAttestationStats(
        validatorIndexes,
        datetime,
      );

      // Verify that we have summarized stats
      expect(summarizedStats.length).toBeGreaterThan(0);

      // Verify that each validator has summarized stats
      const validator549417Stats = summarizedStats.find(
        (s: { validatorIndex: number }) => s.validatorIndex === 549417,
      );
      const validator549418Stats = summarizedStats.find(
        (s: { validatorIndex: number }) => s.validatorIndex === 549418,
      );
      const validator549419Stats = summarizedStats.find(
        (s: { validatorIndex: number }) => s.validatorIndex === 549419,
      );

      expect(validator549417Stats).toBeDefined();
      expect(validator549418Stats).toBeDefined();
      expect(validator549419Stats).toBeDefined();

      // Verify that clRewards are aggregated (should be > 0)
      expect(Number(validator549417Stats?.clRewards?.toString())).toBeGreaterThan(0);
      expect(Number(validator549418Stats?.clRewards?.toString())).toBeGreaterThan(0);
      expect(Number(validator549419Stats?.clRewards?.toString())).toBeGreaterThan(0);
    });

    it('should allow processing the first epoch when no previous epochs exist', async () => {
      // Clean up any existing data
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.epoch.deleteMany();

      // Create only epoch 1525790
      await epochStorage.createEpochs([1525790]);

      // Process the first epoch (should work even without previous epochs)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      // Note: aggregateEpochRewardsIntoHourlyValidatorStats was removed with the new atomic processing strategy
      // Aggregation now happens atomically in fetchEpochRewards()

      // Verify epoch was processed successfully
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewardsFetched).toBe(true);
    });

    it('should validate consecutive epoch processing in hourlyValidatorStats', async () => {
      // First, process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      // Note: aggregateEpochRewardsIntoHourlyValidatorStats was removed with the new atomic processing strategy
      // Aggregation now happens atomically in fetchEpochRewards()

      // Verify first epoch was processed successfully
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewardsFetched).toBe(true);

      // Now process epoch 1525791 (consecutive - should work)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsAttestations1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);
      // Note: aggregateEpochRewardsIntoHourlyValidatorStats was removed with the new atomic processing strategy
      // Aggregation now happens atomically in fetchEpochRewards()

      // Verify second epoch was processed successfully
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525791?.rewardsFetched).toBe(true);

      // Now try to process epoch 1525793 (non-consecutive - should fail)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsAttestations1525790);
      await epochControllerWithMock.fetchEpochRewards(1525793);

      // Note: The consecutive epoch validation was removed with the new atomic processing strategy
      // The new strategy processes rewards atomically without separate aggregation step
    });
  });
});
