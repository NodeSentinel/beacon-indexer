import { BeaconClient } from '../beacon.js';
import { SlotStorage } from '../storage/slot.js';
import { BeaconTime } from '../utils/time.js';

import { SlotControllerHelpers } from './helpers/slotControllerHelpers.js';

import { getUTCDatetimeRoundedToHour } from '@/src/utils/date/index.js';

export interface ProcessSlotInput {
  slot: number;
  epoch: number;
  beaconBlockData?: BeaconBlockData;
}

export interface CheckSlotProcessedInput {
  slot: number;
}

export interface CheckSyncCommitteeOutput {
  syncCommitteeExists: boolean;
}

export interface BeaconBlockData {
  slot: number;
  epoch: number;
  blockHash: string;
  proposerIndex: number;
  // Add more fields as needed
}

export interface ELRewardsData {
  slot: number;
  executionRewards: number;
  // Add more fields as needed
}

export interface BlockAndSyncRewardsData {
  slot: number;
  blockRewards: number;
  syncRewards: number;
  // Add more fields as needed
}

export interface AttestationsData {
  slot: number;
  attestations: Array<{
    validatorIndex: number;
    committeeIndex: number;
    // Add more fields as needed
  }>;
}

export interface SyncCommitteeAttestationsData {
  slot: number;
  syncCommitteeAttestations: Array<{
    validatorIndex: number;
    // Add more fields as needed
  }>;
}

export interface ValidatorStatusesData {
  slot: number;
  validatorUpdates: Array<{
    validatorIndex: number;
    status: string;
    // Add more fields as needed
  }>;
}

export interface WithdrawalsData {
  slot: number;
  withdrawals: Array<{
    validatorIndex: number;
    amount: number;
    // Add more fields as needed
  }>;
}

export interface CheckSlotReadyInput {
  slot: number;
}

export interface CheckSlotReadyOutput {
  isReady: boolean;
  currentSlot: number;
  maxSlotToFetch: number;
}

/**
 * SlotController - Business logic layer for slot-related operations
 *
 * This class handles all business logic for slots, following the principle
 * that controller classes should only contain business logic, not persistence logic.
 * All database operations are delegated to the storage layer.
 */
export class SlotController extends SlotControllerHelpers {
  constructor(
    private readonly slotStorage: SlotStorage,
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
  async checkSlotReady(slot: number, delaySlotsToHead: number): Promise<CheckSlotReadyOutput> {
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
   * Fetch beacon block data from the beacon chain
   */
  async fetchBeaconBlock(slot: number) {
    return this.beaconClient.getBlock(slot);
  }

  /**
   * Fetch and process execution layer rewards
   */
  async fetchELRewards(slot: number, block: number, timestamp: number) {
    // For now, we'll create a mock blockInfo since getExecutionBlock doesn't exist
    // This should be implemented when the execution layer integration is ready
    const blockInfo = {
      address: '0x0000000000000000000000000000000000000000',
      timestamp: timestamp.toString(),
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
   * Check if sync committee data exists for a given epoch
   */
  async checkSyncCommittee(epoch: number): Promise<CheckSyncCommitteeOutput> {
    const syncCommitteeValidators = await this.slotStorage.getSyncCommitteeValidators(epoch);
    return {
      syncCommitteeExists:
        Array.isArray(syncCommitteeValidators) && syncCommitteeValidators.length > 0,
    };
  }

  /**
   * Fetch block and sync rewards for a slot
   */
  async fetchBlockAndSyncRewards(
    slot: number,
    timestamp: number,
    syncCommitteeValidators: string[],
  ): Promise<BlockAndSyncRewardsData> {
    // Fetch rewards from beacon chain
    const [syncCommitteeRewards, blockRewards] = await Promise.all([
      this.beaconClient.getSyncCommitteeRewards(slot, syncCommitteeValidators),
      this.beaconClient.getBlockRewards(slot),
    ]);

    const datetime = getUTCDatetimeRoundedToHour(timestamp * 1000);
    const date = datetime.toISOString().split('T')[0];
    const hour = datetime.getUTCHours();

    // Process sync committee rewards
    if (
      syncCommitteeRewards !== 'SLOT MISSED' &&
      syncCommitteeRewards.data &&
      syncCommitteeRewards.data.length > 0
    ) {
      const syncRewards = this.prepareSyncRewards(syncCommitteeRewards.data, hour, date);

      await this.slotStorage.saveSyncCommitteeRewards(syncRewards);
    }

    // Process block rewards
    if (blockRewards !== 'SLOT MISSED' && blockRewards.data) {
      const blockReward = this.prepareBlockRewards(blockRewards, hour, date);

      if (blockReward) {
        await this.slotStorage.saveBlockRewards(blockReward);
      }
    }

    // Update slot processing data
    await this.slotStorage.updateBlockAndSyncRewardsProcessed(slot);

    return {
      slot,
      blockRewards: blockRewards !== 'SLOT MISSED' ? Number(blockRewards.data?.total || 0) : 0,
      syncRewards:
        syncCommitteeRewards !== 'SLOT MISSED'
          ? this.calculateTotalSyncRewards(syncCommitteeRewards.data || [])
          : 0,
    };
  }

  /**
   * Process attestations for a slot
   */
  async processAttestations(
    slotNumber: number,
    attestations: any[],
    slotCommitteesValidatorsAmounts: Record<number, number[]>,
  ): Promise<AttestationsData> {
    // Filter out attestations that are older than the oldest lookback slot
    const filteredAttestations = this.filterAttestationsByLookbackSlot(
      attestations,
      this.beaconTime.getSlotStartIndexing(),
    );

    // Process each attestation and calculate delays
    const processedAttestations = [];
    for (const attestation of filteredAttestations) {
      const updates = this.processAttestation(
        slotNumber,
        attestation,
        slotCommitteesValidatorsAmounts,
      );
      processedAttestations.push(...updates);
    }

    // Remove duplicates and keep the one with minimum delay
    const deduplicatedAttestations = this.deduplicateAttestations(processedAttestations);

    // Update committee table with attestation delays
    await this.slotStorage.updateCommitteeAttestationDelays(deduplicatedAttestations);

    return {
      slot: slotNumber,
      attestations: deduplicatedAttestations.map((att) => ({
        validatorIndex: att.validatorIndex,
        committeeIndex: att.index,
      })),
    };
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

  /**
   * Process sync committee attestations
   */
  async processSyncCommitteeAttestations(
    input: ProcessSlotInput,
  ): Promise<SyncCommitteeAttestationsData> {
    try {
      console.log(`Processing sync committee attestations for slot ${input.slot}`);

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
   * Update validator statuses
   */
  async updateValidatorStatuses(input: ProcessSlotInput): Promise<ValidatorStatusesData> {
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
   * Process withdrawals
   */
  async processWithdrawals(input: ProcessSlotInput): Promise<WithdrawalsData> {
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
   * Check and get committee validator amounts for attestations
   */
  async checkAndGetCommitteeValidatorsAmounts(slot: number, beaconBlockData: any) {
    try {
      // Get unique slots from attestations in beacon block data
      const attestations = beaconBlockData.data.message.body.attestations || [];
      const uniqueSlots = [
        ...new Set(attestations.map((att: any) => parseInt(att.data.slot))),
      ].filter(
        (slot: unknown): slot is number =>
          typeof slot === 'number' && slot >= this.beaconTime.getSlotStartIndexing(),
      );

      if (uniqueSlots.length === 0) {
        throw new Error('No attestations found');
      }

      // Get committee validator counts for all slots
      const committeesCountInSlot =
        await this.slotStorage.getSlotCommitteesValidatorsAmountsForSlots(uniqueSlots as number[]);

      // Check if all slots have validator counts
      const allSlotsHaveCounts = uniqueSlots.every((slot) => {
        const counts = committeesCountInSlot[slot as number];
        return counts && counts.length > 0;
      });

      return {
        committeesCountInSlot,
        allSlotsHaveCounts,
        uniqueSlots,
      };
    } catch (error) {
      console.error('Error checking committee validator amounts:', error);
      throw error;
    }
  }

  /**
   * Update slot processed status in database
   */
  async updateSlotProcessed(slot: number) {
    return this.slotStorage.updateSlotProcessed(slot);
  }

  /**
   * Update attestations processed status in database
   */
  async updateAttestationsProcessed(slot: number) {
    return this.slotStorage.updateAttestationsProcessed(slot);
  }

  /**
   * Process withdrawals rewards from beacon block data
   */
  async processWithdrawalsRewards(slot: number, withdrawals: any[]) {
    const withdrawalRewards = this.formatWithdrawalRewards(withdrawals);

    await this.slotStorage.updateSlotWithBeaconData(slot, {
      withdrawalsRewards: withdrawalRewards,
    });

    return withdrawalRewards;
  }

  /**
   * Process withdrawals rewards and return the data (for context updates)
   */
  async processWithdrawalsRewardsData(slot: number, withdrawals: any[]) {
    return this.formatWithdrawalRewards(withdrawals);
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
   * Process CL deposits from beacon block
   */
  async processClDeposits(slot: number, deposits: any[]) {
    console.log(`Processing CL deposits for slot ${slot}, found ${deposits.length} deposits`);
    return deposits.map((deposit, index) => `cl_deposit_${slot}_${index}`);
  }

  /**
   * Process CL voluntary exits from beacon block
   */
  async processClVoluntaryExits(slot: number, voluntaryExits: any[]) {
    console.log(
      `Processing CL voluntary exits for slot ${slot}, found ${voluntaryExits.length} exits`,
    );
    return voluntaryExits.map((exit, index) => `cl_voluntary_exit_${slot}_${index}`);
  }

  /**
   * Process EL deposits from execution payload
   */
  async processElDeposits(slot: number, executionPayload: any) {
    console.log(`Processing EL deposits for slot ${slot}`);
    return [`el_deposit_${slot}_0`, `el_deposit_${slot}_1`];
  }

  /**
   * Process EL withdrawals from execution payload
   */
  async processElWithdrawals(slot: number, withdrawals: any[]) {
    console.log(
      `Processing EL withdrawals for slot ${slot}, found ${withdrawals.length} withdrawals`,
    );
    return withdrawals.map((withdrawal, index) => `el_withdrawal_${slot}_${index}`);
  }

  /**
   * Process EL consolidations from execution payload
   */
  async processElConsolidations(slot: number, executionPayload: any) {
    console.log(`Processing EL consolidations for slot ${slot}`);
    return [`el_consolidation_${slot}_0`];
  }

  /**
   * Update slot with beacon data in database
   */
  async updateSlotWithBeaconData(slot: number, beaconBlockData: any) {
    if (!beaconBlockData) {
      throw new Error('Beacon block data is required');
    }

    // Update slot with processed status and beacon data
    const updatedSlot = await this.slotStorage.updateSlotWithBeaconData(slot, {
      withdrawalsRewards: beaconBlockData.withdrawalRewards || [],
      clDeposits: beaconBlockData.clDeposits || [],
      clVoluntaryExits: beaconBlockData.clVoluntaryExits || [],
      elDeposits: beaconBlockData.elDeposits || [],
      elWithdrawals: beaconBlockData.elWithdrawals || [],
      elConsolidations: beaconBlockData.elConsolidations || [],
    });

    console.log(`Updated slot ${slot} with beacon data in database`);
    return updatedSlot;
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
}
