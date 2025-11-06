import { Prisma } from '@beacon-indexer/db';

import { BeaconClient } from '../beacon.js';
import { SlotStorage } from '../storage/slot.js';
import type { Block, Attestation } from '../types.js';
import { BeaconTime } from '../utils/time.js';

import { SlotControllerHelpers } from './helpers/slotControllerHelpers.js';

import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { getUTCDatetimeRoundedToHour } from '@/src/utils/date/index.js';

/**
 * SlotController - Business logic layer for slot-related operations
 */
export class SlotController extends SlotControllerHelpers {
  constructor(
    private readonly slotStorage: SlotStorage,
    private readonly epochStorage: EpochStorage,
    private readonly beaconClient: BeaconClient,
    private readonly beaconTime: BeaconTime,
  ) {
    super();
  }

  /**
   * Get slot by number with processing data
   */
  async getSlot(slot: number) {
    return this.slotStorage.getSlot(slot);
  }

  /**
   * Check if a slot is ready to be processed based on CONSENSUS_DELAY_SLOTS_TO_HEAD
   */
  async canSlotBeProcessed(slot: number, delaySlotsToHead: number) {
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(Date.now());
    const maxSlotToFetch = currentSlot - delaySlotsToHead;
    const isReady = slot <= maxSlotToFetch;

    return {
      isReady,
      currentSlot,
      maxSlotToFetch,
    };
  }

  /**
   * Check if sync committee data exists for a given epoch
   */
  async isSyncCommitteeFetchedForEpoch(epoch: number) {
    return this.epochStorage.isSyncCommitteeForEpochInDB(epoch);
  }

  async isBlockRewardsFetchedForSlot(slot: number) {
    return this.slotStorage.isBlockRewardsFetchedForSlot(slot);
  }

  async isSyncCommitteeFetchedForSlot(slot: number) {
    return this.slotStorage.isSyncCommitteeFetchedForSlot(slot);
  }

  /**
   * Find the next unprocessed slot between startSlot and endSlot
   */
  async findMinUnprocessedSlotInEpoch(startSlot: number, endSlot: number) {
    try {
      return await this.slotStorage.findMinUnprocessedSlotInEpoch(startSlot, endSlot);
    } catch (error) {
      console.error('Error finding next unprocessed slot:', error);
      throw error;
    }
  }

  /**
   * Fetch and process execution layer rewards
   * TODO: Implement using fetch/src/services/execution/endpoints.ts
   * And move to block controller in service/execution
   */
  async fetchELRewards(slot: number, block: number, timestamp: number) {
    const blockInfo: Prisma.ExecutionRewardsUncheckedCreateInput = {
      address: '0x0000000000000000000000000000000000000000',
      timestamp: new Date(timestamp * 1000),
      amount: '0',
      blockNumber: block,
    };

    // Save execution rewards to database
    await this.slotStorage.saveExecutionRewards(blockInfo);

    // Update slot processing data
    await this.slotStorage.updateExecutionRewardsProcessed(slot);

    return {
      slot,
      executionRewards: 0,
    };
  }

  /**
   * Fetch and process sync committee rewards for a slot
   */
  async fetchSyncCommitteeRewards(slot: number, syncCommitteeValidators: string[]) {
    const isSyncCommitteeFetched = await this.isSyncCommitteeFetchedForSlot(slot);
    if (isSyncCommitteeFetched) {
      return;
    }

    // Fetch sync committee rewards from beacon chain
    const syncCommitteeRewards = await this.beaconClient.getSyncCommitteeRewards(
      slot,
      syncCommitteeValidators,
    );

    const slotTimestamp = await this.beaconTime.getTimestampFromSlotNumber(slot);
    const datetime = getUTCDatetimeRoundedToHour(slotTimestamp);

    // Prepare sync committee rewards for processing
    const processedRewards = this.prepareSyncCommitteeRewards(syncCommitteeRewards, slot);

    if (processedRewards.length > 0) {
      // Process sync committee rewards and aggregate into hourly data
      await this.slotStorage.processSyncCommitteeRewardsAndAggregate(
        slot,
        datetime,
        processedRewards,
      );
    } else {
      await this.slotStorage.updateSlotFlags(slot, { syncRewardsFetched: true });
    }
  }

  /**
   * Fetch and process block rewards for a slot
   * These rewards are for the proposer of the block
   */
  async fetchBlockRewards(slot: number) {
    const isBlockRewardsFetched = await this.isBlockRewardsFetchedForSlot(slot);
    if (isBlockRewardsFetched) {
      return;
    }

    // Fetch block rewards from beacon chain
    const blockRewards = await this.beaconClient.getBlockRewards(slot);

    const slotTimestamp = await this.beaconTime.getTimestampFromSlotNumber(slot);
    const datetime = getUTCDatetimeRoundedToHour(slotTimestamp);

    // Prepare block rewards for processing
    const blockRewardData = this.prepareBlockRewards(blockRewards);

    if (blockRewardData) {
      // Process block rewards and aggregate into hourly data
      await this.slotStorage.processBlockRewardsAndAggregate(
        slot,
        blockRewardData.proposerIndex,
        datetime,
        blockRewardData.blockReward,
      );
    } else {
      await this.slotStorage.updateSlotFlags(slot, { blockRewardsFetched: true });
    }
  }

  /**
   * Return the committee sizes for each slot in the beacon block data
   *
   * From the Beacon block data, collect unique `slot` values present in
   * `attestations`, filter out old slots using `this.beaconTime.getLookbackSlot()`,
   * then retrieve committee sizes for those slots from storage.
   *
   * Returns `Record<number, number[]>` where each key is a slot number and the value
   * is an array where each index equals the `committeeIndex` for that slot. That is,
   * `array[0]` is the size of slot.index 0, `array[1]` is the size of slot.index 1,
   * and so on. The value at each position is the number of validators in that committee.
   * Example: `{ 12345: [350, 349, ...] }` means slot 12345 has committee 0 with 350
   * validators, committee 1 with 349 validators, etc.
   */
  private async getCommitteeSizesForAttestations(slotNumber: number, attestations: Attestation[]) {
    // get unique slots from attestations and filter out slots that are older than the lookback slot
    let uniqueSlots = [...new Set(attestations.map((att) => Number(att.data.slot)))];
    uniqueSlots = uniqueSlots.filter((slot) => slot >= this.beaconTime.getLookbackSlot());

    if (uniqueSlots.length === 0) {
      throw new Error(`No attestations found for slot ${slotNumber}`);
    }

    const committeesCountInSlot = await this.slotStorage.getCommitteeSizesForSlots(uniqueSlots);

    // check if all slots have committee sizes
    const allSlotsHaveCounts = uniqueSlots.every((slot) =>
      Boolean(committeesCountInSlot[slot]?.length),
    );
    if (!allSlotsHaveCounts) {
      throw new Error(`Not all slots have committee sizes for beacon block ${slotNumber}`);
    }

    return committeesCountInSlot;
  }

  /**
   * Process attestations for a slot
   */
  private async processAttestations(slotNumber: number, attestations: Attestation[]) {
    // check if attestations are already processed
    const areAttestationsProcessed =
      await this.slotStorage.areAttestationsProcessedForSlot(slotNumber);
    if (areAttestationsProcessed) {
      return;
    }

    // Filter out attestations that are older than the oldest lookback slot
    const filteredAttestations = attestations.filter(
      (attestation) => +attestation.data.slot >= this.beaconTime.getLookbackSlot(),
    );

    // get committee sizes for attestations
    const committeesCountInSlot = await this.getCommitteeSizesForAttestations(
      slotNumber,
      filteredAttestations,
    );

    // Process each attestation and calculate delays
    const processedAttestations = [];
    for (const attestation of filteredAttestations) {
      const updates = this.processAttestation(slotNumber, attestation, committeesCountInSlot);
      processedAttestations.push(...updates);
    }

    // Remove duplicates and keep the one with minimum delay
    const deduplicatedAttestations = this.deduplicateAttestations(processedAttestations);

    // Update hourly validator data/stats with attestation delays
    await this.slotStorage.saveSlotAttestations(deduplicatedAttestations, slotNumber);
  }

  async fetchBlock(slot: number) {
    const beaconBlock = await this.beaconClient.getBlock(slot);

    if (beaconBlock === 'SLOT MISSED') {
      await this.slotStorage.updateSlotProcessed(slot);
      return;
    }

    const tasks: Promise<void>[] = [];
    tasks.push(this.processAttestations(slot, beaconBlock.data.message.body.attestations));

    await Promise.all(tasks);
    // start calling other functions to process the block

    return beaconBlock;
  }

  /**
   * Process sync committee attestations
   * TODO: wtf is this?
   */
  async processSyncCommitteeAttestations(input: {
    slot: number;
    epoch: number;
    beaconBlockData?: Block; // TODO: fix this
  }) {
    try {
      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        slot: input.slot,
        syncCommitteeAttestations: [
          {
            validatorIndex: Math.floor(Math.random() * 1000),
          },
        ],
      };
    } catch (error) {
      console.error('Error processing sync committee attestations:', error);
      throw error;
    }
  }

  /**
   * Process withdrawals
   */
  async processWithdrawals(input: {
    slot: number;
    epoch: number;
    beaconBlockData?: Block; // TODO: fix this
  }) {
    try {
      console.log(`Processing withdrawals for slot ${input.slot}`);

      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 110));

      return {
        slot: input.slot,
        withdrawals: [
          {
            validatorIndex: Math.floor(Math.random() * 1000),
            amount: Math.random() * 32,
          },
        ],
      };
    } catch (error) {
      console.error('Error processing withdrawals:', error);
      throw error;
    }
  }

  /**
   * Process withdrawals rewards from beacon block data
   */
  async processWithdrawalsRewards(
    slot: number,
    withdrawals: Block['data']['message']['body']['execution_payload']['withdrawals'],
  ) {
    const withdrawalRewards = this.formatWithdrawalRewards(withdrawals);

    await this.slotStorage.updateSlotWithBeaconData(slot, {
      withdrawalsRewards: withdrawalRewards,
    });

    return withdrawalRewards;
  }

  /**
   * Process withdrawals rewards and return the data (for context updates)
   */
  async processWithdrawalsRewardsData(
    slot: number,
    withdrawals: Block['data']['message']['body']['execution_payload']['withdrawals'],
  ) {
    return this.formatWithdrawalRewards(withdrawals);
  }

  /**
   * Fetch validators balances for a slot
   */
  async fetchValidatorsBalances(slot: number, validatorIndexes: number[]) {
    // Get validator balances from storage
    const validatorBalances = await this.slotStorage.getValidatorsBalances(validatorIndexes);

    // Format for storage
    const balancesData = validatorBalances.map((validator) => ({
      index: validator.id.toString(),
      balance: validator.balance?.toString() || '0',
    }));

    // Save to database
    await this.slotStorage.saveValidatorBalances(balancesData, slot);

    return balancesData;
  }

  /**
   * Process CL deposits from beacon block
   */
  async processClDeposits(slot: number, deposits: Block['data']['message']['body']['deposits']) {
    console.log(`Processing CL deposits for slot ${slot}, found ${deposits.length} deposits`);
    return deposits.map((deposit, index) => `cl_deposit_${slot}_${index}`);
  }

  /**
   * Process CL voluntary exits from beacon block
   */
  async processClVoluntaryExits(
    slot: number,
    voluntaryExits: Block['data']['message']['body']['voluntary_exits'],
  ) {
    console.log(
      `Processing CL voluntary exits for slot ${slot}, found ${voluntaryExits.length} exits`,
    );
    return voluntaryExits.map((exit, index) => `cl_voluntary_exit_${slot}_${index}`);
  }

  /**
   * Process EL deposits from execution payload
   */
  async processElDeposits(
    slot: number,
    _executionPayload: Block['data']['message']['body']['execution_payload'],
  ) {
    console.log(`Processing EL deposits for slot ${slot}`);
    return [`el_deposit_${slot}_0`, `el_deposit_${slot}_1`];
  }

  /**
   * Process EL withdrawals from execution payload
   */
  async processElWithdrawals(
    slot: number,
    withdrawals: Block['data']['message']['body']['execution_payload']['withdrawals'],
  ) {
    console.log(
      `Processing EL withdrawals for slot ${slot}, found ${withdrawals.length} withdrawals`,
    );
    return withdrawals.map((withdrawal, index) => `el_withdrawal_${slot}_${index}`);
  }

  /**
   * Process EL consolidations from execution payload
   */
  async processElConsolidations(
    slot: number,
    _executionPayload: Block['data']['message']['body']['execution_payload'],
  ) {
    console.log(`Processing EL consolidations for slot ${slot}`);
    return [`el_consolidation_${slot}_0`];
  }

  /**
   * Update slot processed status in database
   */
  async updateSlotProcessed(slot: number) {
    // TODO: check all flags are set to true
    return this.slotStorage.updateSlotProcessed(slot);
  }

  /**
   * Update attestations processed status in database
   */
  async updateAttestationsProcessed(slot: number) {
    return this.slotStorage.updateAttestationsProcessed(slot);
  }

  /**
   * Update withdrawals processed status in database
   */
  async updateWithdrawalsProcessed(slot: number) {
    return this.slotStorage.updateSlotWithBeaconData(slot, {
      withdrawalsRewards: [], // Empty array indicates processed but no withdrawals
    });
  }

  /**
   * Update validator statuses
   */
  async updateValidatorStatuses(input: {
    slot: number;
    epoch: number;
    beaconBlockData?: Block; // TODO: fix this
  }) {
    try {
      console.log(`Updating validator statuses for slot ${input.slot}`);

      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 90));

      return {
        slot: input.slot,
        validatorUpdates: [
          {
            validatorIndex: Math.floor(Math.random() * 1000),
            status: 'active',
          },
        ],
      };
    } catch (error) {
      console.error('Error updating validator statuses:', error);
      throw error;
    }
  }

  /**
   * Update slot with beacon data in database
   */
  async updateSlotWithBeaconData(slot: number, beaconBlockData: Block) {
    if (!beaconBlockData) {
      throw new Error('Beacon block data is required');
    }

    // Update slot with processed status and beacon data
    const updatedSlot = await this.slotStorage.updateSlotWithBeaconData(slot, {
      withdrawalsRewards: [], // Processed separately
      clDeposits: [], // Processed separately
      clVoluntaryExits: [], // Processed separately
      elDeposits: [], // Processed separately
      elWithdrawals: [], // Processed separately
      elConsolidations: [], // Processed separately
    });

    console.log(`Updated slot ${slot} with beacon data in database`);
    return updatedSlot;
  }

  /**
   * Update slot processing status after block and sync rewards are processed
   */
  async updateBlockAndSyncRewardsProcessed(slot: number) {
    return this.slotStorage.updateBlockAndSyncRewardsProcessed(slot);
  }

  /**
   * Cleanup old committee data
   */
  async cleanupOldCommittees(slot: number, slotsPerEpoch: number, maxAttestationDelay: number) {
    const deletedCount = await this.slotStorage.cleanupOldCommittees(
      slot,
      slotsPerEpoch,
      maxAttestationDelay,
    );

    return {
      slot,
      cleanupCompleted: true,
      deletedCount,
    };
  }
}
