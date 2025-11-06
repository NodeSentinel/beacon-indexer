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
      const slot = await slotStorage.getBaseSlot(24497230);
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
      const slotData24497230 = await slotStorage.getBaseSlot(24497230);
      expect(slotData24497230?.syncRewardsFetched).toBe(true);

      // Process slot 24497231
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497231);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497231, ['mocked', 'list']);

      const slotData24497231 = await slotStorage.getBaseSlot(24497231);
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
      await prisma.validatorWithdrawals.deleteMany();
      await prisma.validatorWithdrawalsRequests.deleteMany();
      await prisma.validatorDeposits.deleteMany();
      await prisma.validatorConsolidationsRequests.deleteMany();

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
      // Pre-create slot with consensusRewardsFetched = true
      await slotStorage.updateSlotFlags(24497230, { consensusRewardsFetched: true });

      mockBeaconClient.getBlockRewards.mockResolvedValueOnce({});

      // Try to process (should skip due to existing flag)
      await slotControllerWithMock.fetchSlotConsensusRewards(24497230);

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
      const processSpy = vi.spyOn(slotStorage, 'processSlotConsensusRewardsForSlot');

      // Process slot 24519345
      await slotControllerWithMock.fetchSlotConsensusRewards(24519345);

      // Verify slot flag was updated (even for missed blocks)
      const slot = await slotStorage.getBaseSlot(24519345);
      expect(slot.consensusRewardsFetched).toBe(true);

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
      await slotControllerWithMock.fetchSlotConsensusRewards(24519343);

      // Verify slot flag and proposer were updated
      const slotData24519343 = await slotStorage.getBaseSlot(24519343);
      expect(slotData24519343?.consensusRewardsFetched).toBe(true);
      expect(slotData24519343?.proposerIndex).toBe(536011);
      // Verify consensus reward is stored in Slot
      expect(slotData24519343?.consensusReward?.toString()).toBe('20546222');

      // Process slot 24519344
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519344);
      await slotControllerWithMock.fetchSlotConsensusRewards(24519344);

      const slotData24519344 = await slotStorage.getBaseSlot(24519344);
      expect(slotData24519344?.consensusRewardsFetched).toBe(true);
      expect(slotData24519344?.proposerIndex).toBe(550617);
      // Verify consensus reward is stored in Slot
      expect(slotData24519344?.consensusReward?.toString()).toBe('20990521');

      // ------------------------------------------------------------
      // Validator 536011 (Proposer slot 24519343)
      // ------------------------------------------------------------
      // Get slot directly by slot number
      const slot536011 = await slotStorage.getBaseSlot(24519343);
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
      const slot550617 = await slotStorage.getBaseSlot(24519344);
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

  describe('fetchBlock', () => {
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

    beforeAll(async () => {
      // Clean up database
      await prisma.committee.deleteMany();
      await prisma.slotProcessedData.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.validator.deleteMany();
      await prisma.epoch.deleteMany();
      await prisma.validatorWithdrawals.deleteMany();
      await prisma.validatorWithdrawalsRequests.deleteMany();
      await prisma.validatorDeposits.deleteMany();
      await prisma.validatorConsolidationsRequests.deleteMany();

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

      // Verify slot 24672000 exists and has committeesCountInSlot (needed for attestation processing)
      const slot24672000Data = await slotStorage.getBaseSlot(slot24672000);
      expect(slot24672000Data).toBeDefined();
      expect(slot24672000Data?.committeesCountInSlot).toBeDefined();
      expect(Array.isArray(slot24672000Data?.committeesCountInSlot)).toBe(true);
      expect((slot24672000Data?.committeesCountInSlot as number[]).length).toBeGreaterThan(0);

      // Process fetchBlock once with mock data
      const blockData = blockData24672001 as Block;
      mockBeaconClient.getBlock.mockResolvedValueOnce(blockData);

      // Process slot 24672001 (this will process attestations, withdrawals, and execution requests)
      const result = await slotControllerWithMock.processSlotData(slot24672001);
      expect(result).toBeDefined();
      expect(result).not.toBe('SLOT MISSED');
    });

    describe('fetchAttestations', () => {
      it('should verify attestations were processed and flag was set', async () => {
        // Verify slot flag was updated (this confirms saveSlotAttestations was called)
        const slotData = await slotStorage.getBaseSlot(slot24672001);
        expect(slotData).toBeDefined();
        expect(slotData?.attestationsFetched).toBe(true);
      });

      it('should verify attestation delays for missed and on-time validators', async () => {
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

    describe('withdrawals', () => {
      it('should verify withdrawals were processed and flag was set', async () => {
        // Verify slot flag was updated
        const slotData = await slotStorage.getBaseSlot(slot24672001);
        expect(slotData).toBeDefined();
        expect(slotData?.validatorWithdrawalsFetched).toBe(true);
      });

      it('should verify all withdrawals from mock data were saved correctly', async () => {
        // Expected withdrawals from block_24672001.json
        const expectedWithdrawals = [
          { validatorIndex: '300993', amount: BigInt('12003217') },
          { validatorIndex: '300994', amount: BigInt('12023599') },
          { validatorIndex: '300995', amount: BigInt('11995355') },
          { validatorIndex: '300996', amount: BigInt('12014455') },
          { validatorIndex: '300997', amount: BigInt('11994342') },
          { validatorIndex: '300998', amount: BigInt('12024224') },
          { validatorIndex: '300999', amount: BigInt('12001852') },
          { validatorIndex: '301000', amount: BigInt('12007175') },
        ];

        // Get all withdrawals for slot 24672001 using storage method
        const withdrawals = await slotStorage.getValidatorWithdrawalsForSlot(slot24672001);

        // Verify we have the correct number of withdrawals
        expect(withdrawals.length).toBe(expectedWithdrawals.length);

        // Verify each withdrawal matches expected data
        for (let i = 0; i < expectedWithdrawals.length; i++) {
          const expected = expectedWithdrawals[i];
          const actual = withdrawals[i];

          expect(actual.slot).toBe(slot24672001);
          expect(actual.validatorIndex).toBe(expected.validatorIndex);
          expect(actual.amount.toString()).toBe(expected.amount.toString());
        }
      });
    });

    describe('executionRequests', () => {
      it('should verify execution requests flag was set', async () => {
        // Verify slot flag was updated
        const slotData = await slotStorage.getBaseSlot(slot24672001);
        expect(slotData).toBeDefined();
        expect(slotData?.executionRequestsFetched).toBe(true);
      });

      it('should verify deposits from execution requests were saved correctly', async () => {
        // Expected deposits from block_24672001.json
        const expectedDeposits = [
          {
            pubkey:
              '0x95bfbd34770dcf14d605342f8141ff54c5737af55edd3034dd3bc3beecef5c610b38860de24e2de99a179ad61d535bdb',
            amount: BigInt('32000000000'),
          },
          {
            pubkey:
              '0xa1202e8dec943df62a030f6d8226393c9914d12d6a03edfbeac2979326f63daa104bc6aacbffb39747db0552497065a4',
            amount: BigInt('32000000000'),
          },
        ];

        // Get all deposits for slot 24672001 using storage method
        const deposits = await slotStorage.getValidatorDepositsForSlot(slot24672001);

        // Verify we have the correct number of deposits
        expect(deposits.length).toBe(expectedDeposits.length);

        // Verify each deposit matches expected data
        for (let i = 0; i < expectedDeposits.length; i++) {
          const expected = expectedDeposits[i];
          const actual = deposits[i];

          expect(actual.slot).toBe(slot24672001);
          expect(actual.pubkey).toBe(expected.pubkey);
          expect(actual.amount.toString()).toBe(expected.amount.toString());
        }
      });

      it('should verify withdrawal requests from execution requests were saved correctly', async () => {
        // Expected withdrawal request from block_24672001.json
        const expectedWithdrawalRequest = {
          pubKey:
            '0xa5256ce2de7b9bd44f3dc7e368d27386b1958373e7c04bcb97805bf382ecd6cd56716499f4dc625f3fab6f2cfca8fa0b',
          amount: BigInt('640000000'),
        };

        // Get all withdrawal requests for slot 24672001 using storage method
        const withdrawalRequests =
          await slotStorage.getValidatorWithdrawalsRequestsForSlot(slot24672001);

        // Verify we have the correct number of withdrawal requests
        expect(withdrawalRequests.length).toBe(1);

        // Verify the withdrawal request matches expected data
        const actual = withdrawalRequests[0];
        expect(actual.slot).toBe(slot24672001);
        expect(actual.pubKey).toBe(expectedWithdrawalRequest.pubKey);
        expect(actual.amount.toString()).toBe(expectedWithdrawalRequest.amount.toString());
      });

      it('should verify consolidation requests from execution requests were saved correctly', async () => {
        // Expected consolidations from block_24672001.json
        const expectedConsolidations = [
          {
            sourcePubkey:
              '0xb311b7458d61a0124060557cbce90d002473cfc301e0e7898f0f11ba52894cdb125214234258a710d041771e53e19ac5',
            targetPubkey:
              '0x84e8a653de922a22b844a78caec1de0a1891a5ba633ce4138d537424abe8853e586a3b5a1580c71d25671e733aaf1114',
          },
          {
            sourcePubkey:
              '0xa0b865f5e3663fdb3a446f4d6eb1bac845988f834fea306c3708e827f5565f633b8a41c62b15a567c0aed5944e703ffa',
            targetPubkey:
              '0x84e8a653de922a22b844a78caec1de0a1891a5ba633ce4138d537424abe8853e586a3b5a1580c71d25671e733aaf1114',
          },
        ];

        // Get all consolidation requests for slot 24672001 using storage method
        const consolidationRequests =
          await slotStorage.getValidatorConsolidationsRequestsForSlot(slot24672001);

        // Verify we have the correct number of consolidation requests
        expect(consolidationRequests.length).toBe(expectedConsolidations.length);

        // Verify each consolidation request matches expected data
        // Don't rely on order - find by sourcePubkey and then verify targetPubkey
        for (const expected of expectedConsolidations) {
          const actual = consolidationRequests.find(
            (req) => req.sourcePubkey === expected.sourcePubkey,
          );

          expect(actual).toBeDefined();
          expect(actual?.slot).toBe(slot24672001);
          expect(actual?.sourcePubkey).toBe(expected.sourcePubkey);
          expect(actual?.targetPubkey).toBe(expected.targetPubkey);
        }
      });
    });
  });
});
