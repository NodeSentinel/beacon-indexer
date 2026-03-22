import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
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

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { ValidatorControllerHelpers } from '@/src/services/consensus/controllers/helpers/validatorControllerHelpers.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { PartitionStorage } from '@/src/services/consensus/storage/partition.js';
import { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { GetCommittees, GetValidators, Block } from '@/src/services/consensus/types.js';
import { ExecutionClient } from '@/src/services/execution/execution.js';

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

    validatorsStorage = new ValidatorsStorage(prisma, process.env.DATABASE_URL!);
    slotStorage = new SlotStorage(prisma);
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 32000,
    });

    await prisma.committee.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.validatorDeposits.deleteMany();
    await prisma.validatorWithdrawals.deleteMany();
    await prisma.validatorWithdrawalsRequests.deleteMany();
    await prisma.validatorConsolidationsRequests.deleteMany();
    await prisma.validatorExits.deleteMany();
  });

  afterAll(async () => {
    await EpochStorage.closePgPool();
    await ValidatorsStorage.closePgPool();
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
      await prisma.committee.deleteMany();
      await prisma.syncCommitteeRewards.deleteMany();
      await prisma.validatorDeposits.deleteMany();
      await prisma.validatorWithdrawals.deleteMany();
      await prisma.validatorWithdrawalsRequests.deleteMany();
      await prisma.validatorConsolidationsRequests.deleteMany();
      await prisma.validatorExits.deleteMany();

      // Create mock beacon client
      mockBeaconClient = {
        slotStartIndexing: 32000,
        getSyncCommitteeRewards: vi.fn(),
      };

      // Create execution client mock
      const mockExecutionClient = new ExecutionClient({
        executionBlockscoutUrl: 'http://mock-execution',
        executionEtherscanUrl: 'http://mock-execution-backup',
        chainId: gnosisConfig.blockchain.chainId,
        slotDuration: gnosisConfig.beacon.slotDuration,
        requestsPerSecond: 3,
      });

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
        mockExecutionClient,
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(
          v as unknown as GetValidators['data'][number],
        ),
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
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230);

      // Verify beacon client was not called
      expect(mockBeaconClient.getSyncCommitteeRewards).not.toHaveBeenCalled();
    });

    it('should handle missed slots', async () => {
      // Mock sync committee rewards for missed slot
      const mockMissedSyncCommitteeRewards = 'SLOT MISSED';

      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(
        mockMissedSyncCommitteeRewards,
      );

      // Spy on saveSyncRewards to verify it's NOT called for missed slots
      const saveSpy = vi.spyOn(slotStorage, 'saveSyncRewards');

      // Process slot 24497230 - should throw error for missed slots
      await expect(slotControllerWithMock.fetchSyncCommitteeRewards(24497230)).rejects.toThrow(
        'Sync committee rewards are required',
      );

      // Verify slot flag was NOT updated for missed slots
      const slot = await slotStorage.getBaseSlot(24497230);
      expect(slot?.syncRewardsFetched).toBe(false);

      // Verify saveSyncRewards was NOT called for missed slot
      expect(saveSpy).not.toHaveBeenCalled();

      saveSpy.mockRestore();
    });

    it('should process sync committee rewards and verify ValidatorSyncRewards table', async () => {
      // Process slot 24497230
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497230);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497230);

      // Verify slot flag was updated
      const slotData24497230 = await slotStorage.getBaseSlot(24497230);
      expect(slotData24497230?.syncRewardsFetched).toBe(true);

      // Process slot 24497231
      mockBeaconClient.getSyncCommitteeRewards.mockResolvedValueOnce(rewardsSyncCommittee24497231);
      await slotControllerWithMock.fetchSyncCommitteeRewards(24497231);

      const slotData24497231 = await slotStorage.getBaseSlot(24497231);
      expect(slotData24497231?.syncRewardsFetched).toBe(true);

      // ------------------------------------------------------------
      // Validator 458175
      // ------------------------------------------------------------
      // Get sync committee rewards from validatorSyncRewards table
      const syncRewards458175 = await slotStorage.getSyncCommitteeRewardsForValidatorInSlots(
        458175,
        [24497230, 24497231],
      );
      expect(syncRewards458175).toBeDefined();
      expect(syncRewards458175.length).toBe(2);
      // Validator 458175 appears in both slots with reward 10437 each
      expect(syncRewards458175.find((r) => r.slot === 24497230)?.syncCommittee.toString()).toBe(
        '10437',
      );
      expect(syncRewards458175.find((r) => r.slot === 24497231)?.syncCommittee.toString()).toBe(
        '10437',
      );

      // ------------------------------------------------------------
      // Validator 272088
      // ------------------------------------------------------------
      // Get sync committee rewards from validatorSyncRewards table
      const syncRewards272088 = await slotStorage.getSyncCommitteeRewardsForValidatorInSlots(
        272088,
        [24497230, 24497231],
      );
      expect(syncRewards272088).toBeDefined();
      expect(syncRewards272088.length).toBe(2);
      // Validator 272088 appears in both slots with reward 10437 each
      expect(syncRewards272088.find((r) => r.slot === 24497230)?.syncCommittee.toString()).toBe(
        '10437',
      );
      expect(syncRewards272088.find((r) => r.slot === 24497231)?.syncCommittee.toString()).toBe(
        '10437',
      );
    });
  });

  describe('fetchBlockRewards', () => {
    let mockBeaconClient: Pick<BeaconClient, 'slotStartIndexing'> & {
      getBlockRewards: ReturnType<typeof vi.fn>;
    };
    let slotControllerWithMock: SlotController;

    beforeEach(async () => {
      // Clean up database
      await prisma.committee.deleteMany();
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

      // Create execution client mock
      const mockExecutionClient = new ExecutionClient({
        executionBlockscoutUrl: 'http://mock-execution',
        executionEtherscanUrl: 'http://mock-execution-backup',
        chainId: gnosisConfig.blockchain.chainId,
        slotDuration: gnosisConfig.beacon.slotDuration,
        requestsPerSecond: 3,
      });

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
        mockExecutionClient,
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(
          v as unknown as GetValidators['data'][number],
        ),
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

      // Spy on saveBlockRewards to verify it's NOT called for missed blocks
      const saveSpy = vi.spyOn(slotStorage, 'saveBlockRewards');

      // Process slot 24519345 - should throw error for missed blocks
      await expect(slotControllerWithMock.fetchBlockRewards(24519345)).rejects.toThrow(
        'Block reward is required',
      );

      // Verify slot flag was NOT updated for missed blocks
      const slot = await slotStorage.getBaseSlot(24519345);
      expect(slot.consensusRewardsFetched).toBe(false);

      // Verify saveBlockRewards was NOT called for missed block
      expect(saveSpy).not.toHaveBeenCalled();

      saveSpy.mockRestore();
    });

    it('should process block rewards and verify slot table consensusReward', async () => {
      // Process slot 24519343
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519343);
      await slotControllerWithMock.fetchBlockRewards(24519343);

      // Verify slot flag was updated
      const slotData24519343 = await slotStorage.getBaseSlot(24519343);
      expect(slotData24519343?.consensusRewardsFetched).toBe(true);

      // Verify block reward is stored in slot.consensusReward
      const blockReward24519343 = await slotStorage.getBlockRewardForSlot(24519343, 536011);
      expect(blockReward24519343).toBeDefined();
      expect(blockReward24519343?.blockReward.toString()).toBe('20546222');

      // Process slot 24519344
      mockBeaconClient.getBlockRewards.mockResolvedValueOnce(blockRewards24519344);
      await slotControllerWithMock.fetchBlockRewards(24519344);

      const slotData24519344 = await slotStorage.getBaseSlot(24519344);
      expect(slotData24519344?.consensusRewardsFetched).toBe(true);

      // Verify block reward is stored in slot.consensusReward
      const blockReward24519344 = await slotStorage.getBlockRewardForSlot(24519344, 550617);
      expect(blockReward24519344).toBeDefined();
      expect(blockReward24519344?.blockReward.toString()).toBe('20990521');
    });
  });

  /**
   * fetchExecutionRewards tests verify that execution layer rewards
   * (priority fees from the fee recipient) are correctly fetched and stored.
   *
   * The QuickNode calculation test uses real JSON-RPC batch response data captured
   * from Gnosis block 45214731. The mock data is injected at the axios level so
   * the full getBlock() code path (hex parsing, baseFee subtraction, receipt iteration)
   * is exercised end-to-end.
   */
  describe('fetchExecutionRewards', () => {
    let executionClient: ExecutionClient;
    let slotControllerWithMock: SlotController;

    // Real data from Gnosis block 45214731 fetched via QuickNode JSON-RPC batch
    const BLOCK_NUMBER = 45214731;
    const SLOT = 24519343; // reuse an existing test slot number
    const EXPECTED_FEE_RECIPIENT = '0x86ead908fb5d6f900ff109c9e26f79300f99271a';
    // Verified against Blockscout Miner Reward for the same block
    const EXPECTED_REWARD = '1173967697074274';

    // Real QuickNode JSON-RPC batch response for block 45214731 (Gnosis)
    // Captured via: POST https://holy-sly-needle.xdai.quiknode.pro/...
    // with [eth_getBlockByNumber, eth_getBlockReceipts] batch
    const quicknodeBatchResponse = [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: '0x2b1ec0b',
          timestamp: '0x69bac3d6',
          miner: '0x86ead908fb5d6f900ff109c9e26f79300f99271a',
          baseFeePerGas: '0x11',
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: [
          { gasUsed: '0x1cfef', effectiveGasPrice: '0x59a8a094' },
          { gasUsed: '0x3260a', effectiveGasPrice: '0x3b9aca38' },
          { gasUsed: '0x1f256', effectiveGasPrice: '0x3b9aca11' },
          { gasUsed: '0x3b8d8', effectiveGasPrice: '0x3b9aca11' },
          { gasUsed: '0x58217', effectiveGasPrice: '0x3b9aca11' },
          { gasUsed: '0x3764e', effectiveGasPrice: '0x5f5e111' },
          { gasUsed: '0x3b10b', effectiveGasPrice: '0x5632205' },
          { gasUsed: '0x2e857', effectiveGasPrice: '0x22680be' },
          { gasUsed: '0x7b629', effectiveGasPrice: '0x989691' },
          { gasUsed: '0x132d3b', effectiveGasPrice: '0x56' },
          { gasUsed: '0x13aa7a', effectiveGasPrice: '0x56' },
          { gasUsed: '0x5208', effectiveGasPrice: '0x41' },
          { gasUsed: '0x2624bd', effectiveGasPrice: '0x38' },
          { gasUsed: '0x2bd3a', effectiveGasPrice: '0x38' },
          { gasUsed: '0xdcf2', effectiveGasPrice: '0x38' },
        ],
      },
    ];

    beforeEach(async () => {
      // Clean up database
      await prisma.committee.deleteMany();
      await prisma.slot.deleteMany();
      await prisma.validator.deleteMany();
      await prisma.validatorWithdrawals.deleteMany();
      await prisma.validatorWithdrawalsRequests.deleteMany();
      await prisma.validatorDeposits.deleteMany();
      await prisma.validatorConsolidationsRequests.deleteMany();

      // Create execution client with only QuickNode configured (Gnosis chain).
      // Blockscout URL is set to an unreachable address so the fallback chain
      // reaches QuickNode, whose axios POST is intercepted below.
      executionClient = new ExecutionClient({
        executionBlockscoutUrl: 'http://0.0.0.0:1',
        executionEtherscanUrl: 'http://0.0.0.0:1',
        executionQuicknodeUrl: 'http://mock-quicknode',
        executionQuicknodeKey: 'test-key',
        chainId: gnosisConfig.blockchain.chainId,
        slotDuration: gnosisConfig.beacon.slotDuration,
        requestsPerSecond: 3,
      });

      // Create slot controller
      slotControllerWithMock = new SlotController(
        slotStorage,
        {} as EpochStorage,
        { slotStartIndexing: 32000 } as unknown as BeaconClient,
        new BeaconTime({
          genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
          slotDurationMs: gnosisConfig.beacon.slotDuration,
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
          epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
          lookbackSlot: 32000,
        }),
        executionClient,
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(
          v as unknown as GetValidators['data'][number],
        ),
      );
      await validatorsStorage.saveValidators(validators);

      // Create slot
      await slotStorage.createTestSlots([{ slot: SLOT, processed: false }]);
    });

    it('should skip processing if execution rewards already fetched', async () => {
      // Pre-set executionRewardsFetched flag to true
      await slotStorage.updateSlotFlags(SLOT, { executionRewardsFetched: true });

      // Spy on getBlock to verify it's NOT called
      const getBlockSpy = vi.spyOn(executionClient, 'getBlock');

      // Should skip due to existing flag
      await slotControllerWithMock.fetchExecutionRewards(SLOT, BLOCK_NUMBER);

      // Verify execution client was not called
      expect(getBlockSpy).not.toHaveBeenCalled();

      getBlockSpy.mockRestore();
    });

    it('should calculate execution rewards from QuickNode JSON-RPC data and store in DB', async () => {
      // Intercept the axios POST call that getBlock() makes to QuickNode.
      // The real batch JSON-RPC response is returned so the full priority fee
      // calculation (hex parsing, baseFee subtraction, gasUsed multiplication)
      // runs through the production code path.
      const axiosInstance = (executionClient as unknown as { axiosInstance: { post: unknown } })
        .axiosInstance;
      const postSpy = vi
        .spyOn(axiosInstance, 'post' as never)
        .mockResolvedValueOnce({ data: quicknodeBatchResponse } as never);

      // Call fetchExecutionRewards — this triggers getBlock() which calls QuickNode
      await slotControllerWithMock.fetchExecutionRewards(SLOT, BLOCK_NUMBER);

      // Verify the QuickNode batch POST was called with the correct URL and params
      expect(postSpy).toHaveBeenCalledOnce();
      const [url, body] = postSpy.mock.calls[0] as [string, unknown[]];
      // URL should be base + key
      expect(url).toBe('http://mock-quicknode/test-key');
      // Body should be a JSON-RPC batch array
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);

      // Verify the calculated reward matches the expected value
      // (same value Blockscout reports as "Miner Reward" for block 45214731)
      const slotData = await slotStorage.getBaseSlot(SLOT);
      expect(slotData.executionRewardsFetched).toBe(true);
      expect(slotData.executionReward?.toString()).toBe(EXPECTED_REWARD);
      expect(slotData.feeRecipientAddress).toBe(EXPECTED_FEE_RECIPIENT);
      expect(slotData.blockNumber).toBe(BLOCK_NUMBER);

      postSpy.mockRestore();
    });

    it('should throw error when getBlock returns null', async () => {
      // Mock getBlock to return null (block not found)
      const getBlockSpy = vi.spyOn(executionClient, 'getBlock').mockResolvedValueOnce(null);

      // Should throw error for missing block
      await expect(
        slotControllerWithMock.fetchExecutionRewards(SLOT, BLOCK_NUMBER),
      ).rejects.toThrow(`Block ${BLOCK_NUMBER} not found`);

      // Verify slot was NOT updated
      const slotData = await slotStorage.getBaseSlot(SLOT);
      expect(slotData.executionRewardsFetched).toBe(false);

      getBlockSpy.mockRestore();
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
      epochStorage = new EpochStorage(prisma, process.env.DATABASE_URL!);

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

      // Create execution client mock
      const mockExecutionClient = new ExecutionClient({
        executionBlockscoutUrl: 'http://mock-execution',
        executionEtherscanUrl: 'http://mock-execution-backup',
        chainId: gnosisConfig.blockchain.chainId,
        slotDuration: gnosisConfig.beacon.slotDuration,
        requestsPerSecond: 3,
      });

      // Create slot controller with mock
      slotControllerWithMock = new SlotController(
        slotStorage,
        epochStorage,
        mockBeaconClient as unknown as BeaconClient,
        beaconTimeWithLookback,
        mockExecutionClient,
      );

      // Save validators data to database
      const validators = validatorsData.data.map((v) =>
        ValidatorControllerHelpers.mapValidatorDataToDBEntity(
          v as unknown as GetValidators['data'][number],
        ),
      );
      await validatorsStorage.saveValidators(validators);

      // Create epoch 1542000
      await epochStorage.createEpochs([epoch1542000]);

      // Create partitions for the epoch before processing committees
      const partitionStorage = new PartitionStorage(prisma);
      const partitionController = new PartitionController(partitionStorage, beaconTimeWithLookback);
      await partitionController.createPartitionForCommittee(epoch1542000);

      // Load committees for epoch 1542000
      // This will create ALL slots for the epoch (24672000-24672015)
      const committeeDataTyped = committeeData1542000 as GetCommittees;
      mockBeaconClient.getCommittees.mockResolvedValueOnce(committeeDataTyped.data);
      await epochControllerWithMock.fetchCommittees(epoch1542000);

      // Note: slot 24672001 is already created by fetchCommittees above
      // No need to manually create it anymore

      // Verify slot 24672000 exists and has committeesCountInSlot (needed for attestation processing)
      const slot24672000Data = await slotStorage.getBaseSlot(slot24672000);
      expect(slot24672000Data).toBeDefined();
      expect(slot24672000Data?.committeesCountInSlot).toBeDefined();
      expect(Array.isArray(slot24672000Data?.committeesCountInSlot)).toBe(true);
      expect((slot24672000Data?.committeesCountInSlot as number[]).length).toBeGreaterThan(0);

      // Process fetchBlock once with mock data
      const blockData = blockData24672001 as Block;
      mockBeaconClient.getBlock.mockResolvedValueOnce(blockData);

      // Process slot 24672001 using individual methods
      await slotControllerWithMock.processAttestations(
        slot24672001,
        blockData.data.message.body.attestations,
      );
      await slotControllerWithMock.processEpWithdrawals(
        slot24672001,
        blockData.data.message.body.execution_payload.withdrawals,
      );
      if (blockData.data.message.body.execution_requests) {
        await slotControllerWithMock.processErDeposits(
          slot24672001,
          blockData.data.message.body.execution_requests.deposits || [],
        );
        await slotControllerWithMock.processErWithdrawals(
          slot24672001,
          blockData.data.message.body.execution_requests.withdrawals || [],
        );
        await slotControllerWithMock.processErConsolidations(
          slot24672001,
          blockData.data.message.body.execution_requests.consolidations || [],
        );
      }
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
        expect(slotData?.epWithdrawalsFetched).toBe(true);
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
      it('should verify execution requests flags were set', async () => {
        // Verify slot flags were updated
        const slotData = await slotStorage.getBaseSlot(slot24672001);
        expect(slotData).toBeDefined();
        expect(slotData?.erDepositsFetched).toBe(true);
        expect(slotData?.erWithdrawalsFetched).toBe(true);
        expect(slotData?.erConsolidationsFetched).toBe(true);
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
