import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import rewardsData1525790 from './mocks/rewardsAttestations_1525790.json' with { type: 'json' };
import rewardsData1525791 from './mocks/rewardsAttestations_1525791.json' with { type: 'json' };
import validatorsData from './mocks/validators.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { mapValidatorDataToDBEntity } from '@/src/services/consensus/utils/mappers/validatorMapper.js';
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

    // /eth/v1/beacon/rewards/attestations/1525790
    // /eth/v1/beacon/states/24412640/validators
    // ["549417","549418","549419","549046"]
  });

  describe('fetchAttestationRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getAttestationRewards: ReturnType<typeof vi.fn>;
    };
    let epochControllerWithMock: EpochController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourly_validator_attestation_stats.deleteMany();
      await prisma.epoch_rewards.deleteMany();
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

    it('should fetch and save attestation rewards for epoch 1525790', async () => {
      // Mock the beacon client response for epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);

      // Call fetchAttestationRewards for epoch 1525790
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify that epoch_rewards were saved
      const epochRewards = await prisma.epoch_rewards.findMany({
        where: { epoch: 1525790 },
      });
      expect(epochRewards.length).toBeGreaterThan(0);

      // Verify specific rewards for each validator in epoch_rewards
      const validator549417Rewards = epochRewards.filter((r: any) => r.validator_index === 549417);
      const validator549418Rewards = epochRewards.filter((r: any) => r.validator_index === 549418);
      const validator549419Rewards = epochRewards.filter((r: any) => r.validator_index === 549419);

      // Check that we have rewards for all validators
      expect(validator549417Rewards.length).toBeGreaterThan(0);
      expect(validator549418Rewards.length).toBeGreaterThan(0);
      expect(validator549419Rewards.length).toBeGreaterThan(0);

      // Verify epoch was marked as rewards_fetched
      const epoch = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch?.rewards_fetched).toBe(true);
    });

    it('should fetch and save attestation rewards for epoch 1525791 and verify cumulative data', async () => {
      // First, process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsData1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify first epoch was fetched
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewards_fetched).toBe(true);

      // Now process epoch 1525791
      mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(rewardsData1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);

      // Verify second epoch was fetched
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525791?.rewards_fetched).toBe(true);

      // Verify that both epochs have their own data in epoch_rewards
      const epoch1525790Rewards = await prisma.epoch_rewards.findMany({
        where: { epoch: 1525790 },
      });
      const epoch1525791Rewards = await prisma.epoch_rewards.findMany({
        where: { epoch: 1525791 },
      });

      expect(epoch1525790Rewards.length).toBeGreaterThan(0);
      expect(epoch1525791Rewards.length).toBeGreaterThan(0);
    });

    it('should verify ideal rewards calculation is consistent', async () => {
      // Mock the beacon client response
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);

      // Call fetchAttestationRewards
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify that the mock was called with correct parameters
      // Note: validator 549046 has status "withdrawal_possible" so it's not included in attesting validators
      expect(mockBeaconClient.getAttestationRewards).toHaveBeenCalledWith(
        1525790,
        [549417, 549418, 549419],
      );

      // Ensure that validator 549046 (withdrawal_possible status) is NOT included in the call
      // This validates that the filtering logic correctly excludes non-attesting validators
      const callArgs = mockBeaconClient.getAttestationRewards.mock.calls[0];
      const validatorIds = callArgs[1];
      expect(validatorIds).not.toContain(549046);
      expect(validatorIds).toHaveLength(3);

      // Verify that epoch_rewards were saved correctly
      const epochRewards = await prisma.epoch_rewards.findMany({
        where: { epoch: 1525790 },
      });

      // Verify that we have rewards for all validators
      expect(epochRewards.length).toBeGreaterThan(0);

      // Verify that the rewards were saved with correct validator indices
      const validator549417Rewards = epochRewards.filter((r: any) => r.validator_index === 549417);
      expect(validator549417Rewards.length).toBeGreaterThan(0);
    });

    it('should only include active validators in getAttestationRewards call', async () => {
      // Mock the beacon client response
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);

      // Call fetchAttestationRewards
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify that only validators with active status are included
      const callArgs = mockBeaconClient.getAttestationRewards.mock.calls[0];
      const validatorIds = callArgs[1];

      // Should include active validators: 549417, 549418, 549419 (all have "active_ongoing" status)
      expect(validatorIds).toContain(549417);
      expect(validatorIds).toContain(549418);
      expect(validatorIds).toContain(549419);

      // Should NOT include validator 549046 (has "withdrawal_possible" status)
      expect(validatorIds).not.toContain(549046);

      // Should have exactly 3 validators (only the active ones)
      expect(validatorIds).toHaveLength(3);

      // Verify the call was made with the correct epoch
      expect(callArgs[0]).toBe(1525790);
    });

    it('should summarize epoch rewards into hourly validator attestation stats', async () => {
      // Mock the beacon client response
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);

      // First, fetch attestation rewards
      await epochControllerWithMock.fetchEpochRewards(1525790);

      // Verify epoch was marked as fetched
      const epochAfterFetch = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epochAfterFetch?.rewards_fetched).toBe(true);
      expect(epochAfterFetch?.rewards_summarized).toBe(false);

      // Now summarize the rewards
      await epochControllerWithMock.summarizeEpochRewardsHourly(1525790);

      // Verify epoch was marked as summarized
      const epochAfterSummary = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epochAfterSummary?.rewards_summarized).toBe(true);

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
      const validator549417Stats = summarizedStats.find((s: any) => s.validator_index === 549417);
      const validator549418Stats = summarizedStats.find((s: any) => s.validator_index === 549418);
      const validator549419Stats = summarizedStats.find((s: any) => s.validator_index === 549419);

      expect(validator549417Stats).toBeDefined();
      expect(validator549418Stats).toBeDefined();
      expect(validator549419Stats).toBeDefined();

      // Verify that attestation_rewards are aggregated (should be > 0)
      expect(Number(validator549417Stats?.attestation_rewards?.toString())).toBeGreaterThan(0);
      expect(Number(validator549418Stats?.attestation_rewards?.toString())).toBeGreaterThan(0);
      expect(Number(validator549419Stats?.attestation_rewards?.toString())).toBeGreaterThan(0);
    });

    it('should validate consecutive epoch processing in hourly_validator_attestation_stats', async () => {
      // First, process epoch 1525790
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      await epochControllerWithMock.summarizeEpochRewardsHourly(1525790);

      // Verify first epoch was processed successfully
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewards_summarized).toBe(true);

      // Now process epoch 1525791 (consecutive - should work)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525791);
      await epochControllerWithMock.fetchEpochRewards(1525791);
      await epochControllerWithMock.summarizeEpochRewardsHourly(1525791);

      // Verify second epoch was processed successfully
      const epoch1525791 = await epochControllerWithMock.getEpochByNumber(1525791);
      expect(epoch1525791?.rewards_summarized).toBe(true);

      // Now try to process epoch 1525793 (non-consecutive - should fail)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);
      await epochControllerWithMock.fetchEpochRewards(1525793);

      // This should throw an error because 1525793 is not consecutive after 1525791
      await expect(epochControllerWithMock.summarizeEpochRewardsHourly(1525793)).rejects.toThrow(
        'Epoch 1525793 is not consecutive. Expected next epoch: 1525792, but got: 1525793',
      );
    });

    it('should allow processing the first epoch when no previous epochs exist', async () => {
      // Clean up any existing data
      await prisma.hourly_validator_attestation_stats.deleteMany();
      await prisma.epoch_rewards.deleteMany();
      await prisma.epoch.deleteMany();

      // Create only epoch 1525790
      await epochStorage.createEpochs([1525790]);

      // Process the first epoch (should work even without previous epochs)
      mockBeaconClient.getAttestationRewards.mockResolvedValue(rewardsData1525790);
      await epochControllerWithMock.fetchEpochRewards(1525790);
      await epochControllerWithMock.summarizeEpochRewardsHourly(1525790);

      // Verify epoch was processed successfully
      const epoch1525790 = await epochControllerWithMock.getEpochByNumber(1525790);
      expect(epoch1525790?.rewards_summarized).toBe(true);
    });
  });
});
