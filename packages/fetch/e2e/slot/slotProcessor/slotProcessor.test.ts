import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import validatorsData from '../../epoch/epochProcessor/mocks/validators.json' with { type: 'json' };

import rewardsSyncCommittee24497230 from './mocks/rewardsSyncCommittee_24497230.json' with { type: 'json' };
import rewardsSyncCommittee24497231 from './mocks/rewardsSyncCommittee_24497231.json' with { type: 'json' };
import blockRewards24519343 from './mocks/slotRewards_ 24519343.json' with { type: 'json' };
import blockRewards24519344 from './mocks/slotRewards_ 24519344.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorControllerHelpers } from '@/src/services/consensus/controllers/helpers/validatorControllerHelpers.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { getUTCDatetimeRoundedToHour } from '@/src/utils/date/index.js';

/**
 * Note: Mocked data from this tests was taken from Gnosis chain.
 * Slots 24497230 and 24497231 correspond to epochs 1530826 and 1530827
 */
describe('Slot Processor E2E Tests', () => {
  let prisma: PrismaClient;
  let slotStorage: SlotStorage;
  let validatorsStorage: ValidatorsStorage;
  let beaconTime: BeaconTime;

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
    slotStorage = new SlotStorage(prisma);
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      slotStartIndexing: 32000,
    });

    await prisma.committee.deleteMany();
    await prisma.slotProcessingData.deleteMany();
    await prisma.slot.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('fetchSyncCommitteeRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getSyncCommitteeRewards: ReturnType<typeof vi.fn>;
    };
    let slotControllerWithMock: SlotController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.hourlyValidatorData.deleteMany();
      await prisma.committee.deleteMany();
      await prisma.slotProcessingData.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.validator.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getSyncCommitteeRewards: vi.fn(),
      };

      // Create slot controller with mock
      slotControllerWithMock = new SlotController(
        slotStorage,
        {} as EpochStorage,
        mockBeaconClient as unknown as BeaconClient,
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

      // Create slots
      await slotStorage.createTestSlots([
        { slot: 24497230, processed: false },
        { slot: 24497231, processed: false },
      ]);
    });

    it('should skip processing if sync committee rewards already processed', async () => {
      // mock beaconClient.getSyncCommitteeRewards
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497230);

      // Pre-create slot with syncRewardsProcessed = true
      await slotStorage.createSlotProcessingData({
        slot: 24497230,
        syncRewardsProcessed: true,
      });

      // Try to process (should skip due to existing flag)
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230, ['mocked', 'list']);

      // Verify beacon client was not called
      expect(mockBeaconClient.getSyncCommitteeRewards).not.toHaveBeenCalled();
    });

    it('should handle missed slots', async () => {
      // Mock sync committee rewards for missed slot
      const mockMissedSyncCommitteeRewards = 'SLOT MISSED';

      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(
        mockMissedSyncCommitteeRewards,
      );

      // Process slot 24497230
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230, ['mocked', 'list']);

      // Verify slot processing data was updated (even for missed slots)
      const slot = await slotStorage.getSlot(24497230);
      expect(slot?.processingData?.syncRewardsProcessed).toBe(true);
    });

    it('should process sync committee rewards and verify HourlyValidatorData and HourlyValidatorStats', async () => {
      // Calculate datetime for slots (both should be in the same hour)
      const slot24497230Timestamp = beaconTime.getTimestampFromSlotNumber(24497230);
      const datetime24497230 = getUTCDatetimeRoundedToHour(slot24497230Timestamp);

      // Initialize existing values for multiple validators to test aggregation
      await slotStorage.createTestHourlyValidatorData({
        datetime: datetime24497230,
        validatorIndex: 458175,
        attestations: '',
        syncCommitteeRewards: '',
        proposedBlocksRewards: '',
        epochRewards: '',
      });
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24497230,
        validatorIndex: 458175,
        clRewards: BigInt(10000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });

      await slotStorage.createTestHourlyValidatorData({
        datetime: datetime24497230,
        validatorIndex: 272088,
        attestations: '',
        syncCommitteeRewards: '',
        proposedBlocksRewards: '',
        epochRewards: '',
      });
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24497230,
        validatorIndex: 272088,
        clRewards: BigInt(20000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });

      // Create slot processing data for both slots
      await slotStorage.createSlotProcessingData({
        slot: 24497230,
      });
      await slotStorage.createSlotProcessingData({
        slot: 24497231,
      });

      // Process slot 24497230
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497230);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230, ['mocked', 'list']);

      // Verify slot processing data was updated
      const slotData24497230 = await slotStorage.getSlot(24497230);
      expect(slotData24497230?.processingData?.syncRewardsProcessed).toBe(true);

      // Process slot 24497231
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497231);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497231, ['mocked', 'list']);

      const slotData24497231 = await slotStorage.getSlot(24497231);
      expect(slotData24497231?.processingData?.syncRewardsProcessed).toBe(true);

      // ------------------------------------------------------------
      // Validator 458175
      // ------------------------------------------------------------
      const hourlyData458175 = await slotStorage.getHourlyValidatorDataForValidator(
        458175,
        datetime24497230,
      );
      expect(hourlyData458175).toBeDefined();
      // Validator 458175 appears in both slots with reward 10437 each
      // Expected format: '24497230:10437,24497231:10437,' (with trailing comma)
      expect(hourlyData458175?.syncCommitteeRewards).toBe('24497230:10437,24497231:10437,');

      const hourlyStats458175 = await slotStorage.getHourlyValidatorStatsForValidator(
        458175,
        datetime24497230,
      );
      expect(hourlyStats458175).toBeDefined();
      // Initial value 10000 + 10437 (slot 24497230) + 10437 (slot 24497231) = 30874
      expect(hourlyStats458175?.clRewards?.toString()).toBe('30874');

      // ------------------------------------------------------------
      // Validator 272088
      // ------------------------------------------------------------
      const hourlyData272088 = await slotStorage.getHourlyValidatorDataForValidator(
        272088,
        datetime24497230,
      );
      expect(hourlyData272088).toBeDefined();
      // Validator 272088 appears in both slots with reward 10437 each
      expect(hourlyData272088?.syncCommitteeRewards).toBe('24497230:10437,24497231:10437,');

      const hourlyStats272088 = await slotStorage.getHourlyValidatorStatsForValidator(
        272088,
        datetime24497230,
      );
      expect(hourlyStats272088).toBeDefined();
      // Initial value 20000 + 10437 (slot 24497230) + 10437 (slot 24497231) = 40874
      expect(hourlyStats272088?.clRewards?.toString()).toBe('40874');
    });
  });

  describe('fetchBlockRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getBlockRewards: ReturnType<typeof vi.fn>;
    };
    let slotControllerWithMock: SlotController;

    beforeEach(async () => {
      // Clean up database
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.hourlyValidatorData.deleteMany();
      await prisma.committee.deleteMany();
      await prisma.slotProcessingData.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.validator.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getBlockRewards: vi.fn(),
      };

      // Create slot controller with mock
      slotControllerWithMock = new SlotController(
        slotStorage,
        {} as EpochStorage,
        mockBeaconClient as unknown as BeaconClient,
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

      // Create slots for fetchBlockRewards tests
      await slotStorage.createTestSlots([
        { slot: 24497230, processed: false },
        { slot: 24497231, processed: false },
        { slot: 24519343, processed: false },
        { slot: 24519344, processed: false },
      ]);
    });

    it('should skip processing if block rewards already processed', async () => {
      // Pre-create slot with blockRewardsProcessed = true
      await slotStorage.createSlotProcessingData({
        slot: 24497230,
        blockRewardsProcessed: true,
      });

      mockBeaconClient.getBlockRewards.mockResolvedValueOnce({});

      // Try to process (should skip due to existing flag)
      await slotControllerWithMock.fetchBlockRewards(24497230);

      // Verify beacon client was not called
      expect(mockBeaconClient.getBlockRewards).not.toHaveBeenCalled();
    });

    it('should handle missed blocks', async () => {
      // Create slot for missed block test
      await slotStorage.createTestSlots([{ slot: 24519345, processed: false }]);

      // Create slot processing data
      await slotStorage.createSlotProcessingData({
        slot: 24519345,
      });

      // Mock block rewards for missed slot
      const mockMissedBlockRewards = 'SLOT MISSED';

      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(mockMissedBlockRewards);

      // Process slot 24519345
      await slotControllerWithMock.fetchBlockRewards(24519345);

      // Verify slot processing data was updated (even for missed blocks)
      const slot = await slotStorage.getSlot(24519345);
      expect(slot?.processingData?.blockRewardsProcessed).toBe(true);
    });

    it('should process block rewards and verify HourlyValidatorData and HourlyValidatorStats', async () => {
      // Calculate datetime for slots
      const slot24519343Timestamp = beaconTime.getTimestampFromSlotNumber(24519343);
      const datetime24519343 = getUTCDatetimeRoundedToHour(slot24519343Timestamp);
      const slot24519344Timestamp = beaconTime.getTimestampFromSlotNumber(24519344);
      const datetime24519344 = getUTCDatetimeRoundedToHour(slot24519344Timestamp);

      // Initialize existing values for validator 536011 to test aggregation
      await slotStorage.createTestHourlyValidatorData({
        datetime: datetime24519343,
        validatorIndex: 536011,
        attestations: '',
        syncCommitteeRewards: '',
        proposedBlocksRewards: '',
        epochRewards: '',
      });
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24519343,
        validatorIndex: 536011,
        clRewards: BigInt(1000000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });

      // For validator 550617, no initial values (starts from scratch)

      // Create slot processing data for both slots
      await slotStorage.createSlotProcessingData({
        slot: 24519343,
      });
      await slotStorage.createSlotProcessingData({
        slot: 24519344,
      });

      // Process slot 24519343
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519343);
      await slotControllerWithMock.fetchBlockRewards(24519343);

      // Verify slot processing data was updated
      const slotData24519343 = await slotStorage.getSlot(24519343);
      expect(slotData24519343?.processingData?.blockRewardsProcessed).toBe(true);
      expect(slotData24519343?.proposer).toBe(536011);

      // Process slot 24519344
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519344);
      await slotControllerWithMock.fetchBlockRewards(24519344);

      const slotData24519344 = await slotStorage.getSlot(24519344);
      expect(slotData24519344?.processingData?.blockRewardsProcessed).toBe(true);
      expect(slotData24519344?.proposer).toBe(550617);

      // ------------------------------------------------------------
      // Validator 536011 (Proposer slot 24519343)
      // ------------------------------------------------------------
      const hourlyData536011 = await slotStorage.getHourlyValidatorDataForValidator(
        536011,
        datetime24519343,
      );
      expect(hourlyData536011).toBeDefined();
      expect(hourlyData536011?.proposedBlocksRewards).toBe('24519343:20546222,');

      const hourlyStats536011 = await slotStorage.getHourlyValidatorStatsForValidator(
        536011,
        datetime24519343,
      );
      expect(hourlyStats536011).toBeDefined();
      // Initial value 1000000 + block reward 20546222 = 21546222
      expect(hourlyStats536011?.clRewards?.toString()).toBe('21546222');

      // ------------------------------------------------------------
      // Validator 550617 (Proposer slot 24519344)
      // ------------------------------------------------------------
      const hourlyData550617 = await slotStorage.getHourlyValidatorDataForValidator(
        550617,
        datetime24519344,
      );
      expect(hourlyData550617).toBeDefined();
      expect(hourlyData550617?.proposedBlocksRewards).toBe('24519344:20990521,');

      const hourlyStats550617 = await slotStorage.getHourlyValidatorStatsForValidator(
        550617,
        datetime24519344,
      );
      expect(hourlyStats550617).toBeDefined();
      // No initial value, should be exactly the block reward
      expect(hourlyStats550617?.clRewards?.toString()).toBe('20990521');
    });
  });
});
