import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Import mock data
import validatorsData from '../../epoch/epochProcessor/mocks/validators.json' with { type: 'json' };

import blockData24672001 from './mocks/block_ 24672001.json' with { type: 'json' };
import committeeData1542000 from './mocks/committee_ 1542000.json' with { type: 'json' };
import rewardsSyncCommittee24497230 from './mocks/rewardsSyncCommittee_24497230.json' with { type: 'json' };
import rewardsSyncCommittee24497231 from './mocks/rewardsSyncCommittee_24497231.json' with { type: 'json' };
import blockRewards24519343 from './mocks/slotRewards_ 24519343.json' with { type: 'json' };
import blockRewards24519344 from './mocks/slotRewards_ 24519344.json' with { type: 'json' };

import { gnosisConfig } from '@/src/config/chain.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorControllerHelpers } from '@/src/services/consensus/controllers/helpers/validatorControllerHelpers.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { GetCommittees, Block } from '@/src/services/consensus/types.js';
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
      lookbackSlot: 32000,
    });

    await prisma.committee.deleteMany();
    await prisma.slotProcessedData.deleteMany();
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
      await prisma.validator.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.slotProcessedData.deleteMany();
      await prisma.committee.deleteMany();
      await prisma.hourlyValidatorStats.deleteMany();
      await prisma.syncCommitteeRewards.deleteMany();

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
          lookbackSlot: 32000,
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

    it('should skip processing if sync committee rewards already fetched', async () => {
      // mock beaconClient.getSyncCommitteeRewards
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497230);

      // Pre-create slot with syncRewardsFetched = true
      await slotStorage.updateSlotFlags(24497230, { syncRewardsFetched: true });

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

      // Spy on processSyncCommitteeRewardsAndAggregate to verify it's NOT called for missed slots
      const processSpy = vi.spyOn(slotStorage, 'processSyncCommitteeRewardsAndAggregate');

      // Process slot 24497230
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230, ['mocked', 'list']);

      // Verify slot flag was updated (even for missed slots)
      const slot = await slotStorage.getSlotWithoutProcessedData(24497230);
      expect(slot?.syncRewardsFetched).toBe(true);

      // Verify processSyncCommitteeRewardsAndAggregate was NOT called for missed slot
      expect(processSpy).not.toHaveBeenCalled();

      processSpy.mockRestore();
    });

    it('should process sync committee rewards and verify syncCommitteeRewards table and HourlyValidatorStats', async () => {
      // Calculate datetime for slots (both should be in the same hour)
      const slot24497230Timestamp = beaconTime.getTimestampFromSlotNumber(24497230);
      const datetime24497230 = getUTCDatetimeRoundedToHour(slot24497230Timestamp);

      // Initialize existing values for multiple validators to test aggregation
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24497230,
        validatorIndex: 458175,
        clRewards: BigInt(10000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24497230,
        validatorIndex: 272088,
        clRewards: BigInt(20000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });

      // Process slot 24497230
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497230);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230, ['mocked', 'list']);

      // Verify slot flag was updated
      const slotData24497230 = await slotStorage.getSlotWithoutProcessedData(24497230);
      expect(slotData24497230?.syncRewardsFetched).toBe(true);

      // Process slot 24497231
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497231);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497231, ['mocked', 'list']);

      const slotData24497231 = await slotStorage.getSlotWithoutProcessedData(24497231);
      expect(slotData24497231?.syncRewardsFetched).toBe(true);

      // ------------------------------------------------------------
      // Validator 458175
      // ------------------------------------------------------------
      // Get sync committee rewards from syncCommitteeRewards table
      const syncRewards458175 = await slotStorage.getSyncCommitteeRewardsForValidatorInSlots(
        458175,
        [24497230, 24497231],
      );
      expect(syncRewards458175).toBeDefined();
      expect(syncRewards458175.length).toBe(2);
      // Validator 458175 appears in both slots with reward 10437 each
      expect(
        syncRewards458175.find((r) => r.slot === 24497230)?.syncCommitteeReward.toString(),
      ).toBe('10437');
      expect(
        syncRewards458175.find((r) => r.slot === 24497231)?.syncCommitteeReward.toString(),
      ).toBe('10437');

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
      // Get sync committee rewards from syncCommitteeRewards table
      const syncRewards272088 = await slotStorage.getSyncCommitteeRewardsForValidatorInSlots(
        272088,
        [24497230, 24497231],
      );
      expect(syncRewards272088).toBeDefined();
      expect(syncRewards272088.length).toBe(2);
      // Validator 272088 appears in both slots with reward 10437 each
      expect(
        syncRewards272088.find((r) => r.slot === 24497230)?.syncCommitteeReward.toString(),
      ).toBe('10437');
      expect(
        syncRewards272088.find((r) => r.slot === 24497231)?.syncCommitteeReward.toString(),
      ).toBe('10437');

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
      await prisma.committee.deleteMany();
      await prisma.slotProcessedData.deleteMany();
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
          lookbackSlot: 32000,
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

    it('should skip processing if block rewards already fetched', async () => {
      // Pre-create slot with blockRewardsFetched = true
      await slotStorage.updateSlotFlags(24497230, { blockRewardsFetched: true });

      mockBeaconClient.getBlockRewards.mockResolvedValueOnce({});

      // Try to process (should skip due to existing flag)
      await slotControllerWithMock.fetchBlockRewards(24497230);

      // Verify beacon client was not called
      expect(mockBeaconClient.getBlockRewards).not.toHaveBeenCalled();
    });

    it('should handle missed blocks', async () => {
      // Create slot for missed block test
      await slotStorage.createTestSlots([{ slot: 24519345, processed: false }]);

      // Mock block rewards for missed slot
      const mockMissedBlockRewards = 'SLOT MISSED';

      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(mockMissedBlockRewards);

      // Spy on processBlockRewardsAndAggregate to verify it's NOT called for missed blocks
      const processSpy = vi.spyOn(slotStorage, 'processBlockRewardsAndAggregate');

      // Process slot 24519345
      await slotControllerWithMock.fetchBlockRewards(24519345);

      // Verify slot flag was updated (even for missed blocks)
      const slot = await slotStorage.getSlotWithoutProcessedData(24519345);
      expect(slot?.blockRewardsFetched).toBe(true);

      // Verify processBlockRewardsAndAggregate was NOT called for missed block
      expect(processSpy).not.toHaveBeenCalled();

      processSpy.mockRestore();
    });

    it('should process block rewards and verify Slot table and HourlyValidatorStats', async () => {
      // Calculate datetime for slots
      const slot24519343Timestamp = beaconTime.getTimestampFromSlotNumber(24519343);
      const datetime24519343 = getUTCDatetimeRoundedToHour(slot24519343Timestamp);
      const slot24519344Timestamp = beaconTime.getTimestampFromSlotNumber(24519344);
      const datetime24519344 = getUTCDatetimeRoundedToHour(slot24519344Timestamp);

      // Initialize existing values for validator 536011 to test aggregation
      await slotStorage.createTestHourlyValidatorStats({
        datetime: datetime24519343,
        validatorIndex: 536011,
        clRewards: BigInt(1000000),
        clMissedRewards: BigInt(0),
        attestationsCount: null,
      });

      // For validator 550617, no initial values (starts from scratch)

      // Process slot 24519343
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519343);
      await slotControllerWithMock.fetchBlockRewards(24519343);

      // Verify slot flag and proposer were updated
      const slotData24519343 = await slotStorage.getSlotWithoutProcessedData(24519343);
      expect(slotData24519343?.blockRewardsFetched).toBe(true);
      expect(slotData24519343?.proposerIndex).toBe(536011);
      // Verify consensus reward is stored in Slot
      expect(slotData24519343?.consensusReward?.toString()).toBe('20546222');

      // Process slot 24519344
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519344);
      await slotControllerWithMock.fetchBlockRewards(24519344);

      const slotData24519344 = await slotStorage.getSlotWithoutProcessedData(24519344);
      expect(slotData24519344?.blockRewardsFetched).toBe(true);
      expect(slotData24519344?.proposerIndex).toBe(550617);
      // Verify consensus reward is stored in Slot
      expect(slotData24519344?.consensusReward?.toString()).toBe('20990521');

      // ------------------------------------------------------------
      // Validator 536011 (Proposer slot 24519343)
      // ------------------------------------------------------------
      // Get slot directly by slot number
      const slot536011 = await slotStorage.getSlotWithoutProcessedData(24519343);
      expect(slot536011).toBeDefined();
      expect(slot536011?.proposerIndex).toBe(536011);
      expect(slot536011?.consensusReward?.toString()).toBe('20546222');

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
      // Get slot directly by slot number
      const slot550617 = await slotStorage.getSlotWithoutProcessedData(24519344);
      expect(slot550617).toBeDefined();
      expect(slot550617?.proposerIndex).toBe(550617);
      expect(slot550617?.consensusReward?.toString()).toBe('20990521');

      const hourlyStats550617 = await slotStorage.getHourlyValidatorStatsForValidator(
        550617,
        datetime24519344,
      );
      expect(hourlyStats550617).toBeDefined();
      // No initial value, should be exactly the block reward
      expect(hourlyStats550617?.clRewards?.toString()).toBe('20990521');
    });
  });

  describe('fetchAttestations', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getBlock: ReturnType<typeof vi.fn>;
      getCommittees: ReturnType<typeof vi.fn>;
    };
    let slotControllerWithMock: SlotController;
    let epochControllerWithMock: EpochController;
    let epochStorage: EpochStorage;
    const lookbackSlot = 24672000;
    const slot24672000 = 24672000;
    const slot24672001 = 24672001; // Attestations for slot 24672000 come at slot 24672001 (n+1 pattern)
    const epoch1542000 = 1542000;

    // Validators that missed slot 24672000
    const missedValidators = [272515, 98804, 421623, 62759] as const;
    // Validators that attested on time for slot 24672000
    const attestedOnTimeValidators = [398596, 471558, 497750] as const;

    beforeEach(async () => {
      // Clean up database
      await prisma.committee.deleteMany();
      await prisma.slotProcessedData.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.validator.deleteMany();
      await prisma.epoch.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: lookbackSlot,
        getBlock: vi.fn(),
        getCommittees: vi.fn(),
      };

      // Create epoch storage
      epochStorage = new EpochStorage(prisma, validatorsStorage);

      // Create beacon time with lookbackSlot set to 24672000
      const beaconTimeWithLookback = new BeaconTime({
        genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
        slotDurationMs: gnosisConfig.beacon.slotDuration,
        slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
        lookbackSlot: lookbackSlot,
      });

      // Create epoch controller with mock
      epochControllerWithMock = new EpochController(
        mockBeaconClient as unknown as BeaconClient,
        epochStorage,
        validatorsStorage,
        beaconTimeWithLookback,
      );

      // Create slot controller with mock
      slotControllerWithMock = new SlotController(
        slotStorage,
        epochStorage,
        mockBeaconClient as unknown as BeaconClient,
        beaconTimeWithLookback,
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(v),
      );
      await validatorsStorage.saveValidators(validators);

      // Create epoch 1542000
      await epochStorage.createEpochs([epoch1542000]);

      // Load committees for epoch 1542000
      const committeeDataTyped = committeeData1542000 as GetCommittees;
      mockBeaconClient.getCommittees.mockResolvedValueOnce(committeeDataTyped.data);
      await epochControllerWithMock.fetchCommittees(epoch1542000);

      // Create slot 24672001 (where attestations come from)
      await slotStorage.createTestSlots([{ slot: slot24672001, processed: false }]);
    });

    it('should skip processing if attestations already fetched', async () => {
      // Pre-create slot with attestationsFetched = true
      await slotStorage.updateSlotFlags(slot24672001, { attestationsFetched: true });

      // Mock block data (even though it won't be processed)
      const blockData = blockData24672001 as Block;
      mockBeaconClient.getBlock.mockResolvedValueOnce(blockData);

      // Spy on saveSlotAttestations to verify it's NOT called
      const saveSpy = vi.spyOn(slotStorage, 'saveSlotAttestations');

      // Try to process (should skip due to existing flag)
      await slotControllerWithMock.fetchBlock(slot24672001);

      // Verify saveSlotAttestations was NOT called (processAttestations checks the flag)
      expect(saveSpy).not.toHaveBeenCalled();

      saveSpy.mockRestore();
    });

    it('should handle missed blocks', async () => {
      // Create slot for missed block test
      await slotStorage.createTestSlots([{ slot: 24672002, processed: false }]);

      // Mock block for missed slot
      const mockMissedBlock = 'SLOT MISSED';

      mockBeaconClient.getBlock.mockResolvedValueOnce(mockMissedBlock);

      // Spy on saveSlotAttestations to verify it's NOT called for missed blocks
      const processSpy = vi.spyOn(slotStorage, 'saveSlotAttestations');

      // Process slot 24672002
      await slotControllerWithMock.fetchBlock(24672002);

      // Verify slot flag was updated (even for missed blocks)
      const slot = await slotStorage.getSlotWithoutProcessedData(24672002);
      expect(slot?.processed).toBe(true);

      // Verify processAttestations was NOT called for missed block
      expect(processSpy).not.toHaveBeenCalled();

      processSpy.mockRestore();
    });

    it('should process attestations and verify attestation delays for missed and on-time validators', async () => {
      // Verify slot 24672001 exists before processing
      const slotDataBefore = await slotStorage.getSlotWithoutProcessedData(slot24672001);
      expect(slotDataBefore).toBeDefined();

      // Verify slot 24672000 exists and has committeesCountInSlot (needed for attestation processing)
      const slot24672000Data = await slotStorage.getSlotWithoutProcessedData(slot24672000);
      expect(slot24672000Data).toBeDefined();
      expect(slot24672000Data?.committeesCountInSlot).toBeDefined();
      expect(Array.isArray(slot24672000Data?.committeesCountInSlot)).toBe(true);
      expect((slot24672000Data?.committeesCountInSlot as number[]).length).toBeGreaterThan(0);

      // Use block data directly from mock file
      const blockData = blockData24672001 as Block;
      mockBeaconClient.getBlock.mockResolvedValueOnce(blockData);

      // Process slot 24672001 (attestations for slot 24672000)
      // Note: fetchBlock uses Promise.allSettled, so errors are silently caught
      // We need to verify the processing completed successfully by checking the flag
      const result = await slotControllerWithMock.fetchBlock(slot24672001);
      expect(result).toBeDefined();
      expect(result).not.toBe('SLOT MISSED');

      // Verify slot flag was updated (this confirms saveSlotAttestations was called)
      const slotData = await slotStorage.getSlotWithoutProcessedData(slot24672001);
      expect(slotData).toBeDefined();
      if (!slotData?.attestationsFetched) {
        // If flag is not set, processAttestations likely failed silently
        // Check if there are any attestations in the block to process
        const attestations = (result as Block).data.message.body.attestations;
        expect(attestations.length).toBeGreaterThan(0);
        // If attestations exist but flag is not set, there was an error
        throw new Error(
          'attestationsFetched flag was not set after processing. This indicates processAttestations failed silently.',
        );
      }
      expect(slotData.attestationsFetched).toBe(true);

      // Get committees for slot 24672000 to verify attestation delays
      const committees = await epochStorage.getCommitteesBySlots([slot24672000]);

      // Filter committees for all validators we're testing (attested and missed) - single filter
      const allValidatorsToTest = [
        ...(attestedOnTimeValidators as readonly number[]),
        ...(missedValidators as readonly number[]),
      ];
      const relevantCommittees = committees.filter((c) =>
        allValidatorsToTest.includes(c.validatorIndex),
      );

      // Verify delays: attested validators have delay = 0, missed validators have delay = null
      expect(relevantCommittees.length).toBeGreaterThan(0);
      for (const committee of relevantCommittees) {
        if ((attestedOnTimeValidators as readonly number[]).includes(committee.validatorIndex)) {
          expect(committee.attestationDelay).toBe(0);
        } else if ((missedValidators as readonly number[]).includes(committee.validatorIndex)) {
          expect(committee.attestationDelay).toBeNull();
        }
      }
    });
  });
});
