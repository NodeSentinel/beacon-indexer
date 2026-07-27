import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { BeaconClient } from '../beacon.js';
import { SlotStorage } from '../storage/slot.js';

import type { Attestation, Block } from '../types.js';
import { SlotControllerHelpers } from './helpers/slotControllerHelpers.js';

import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ExecutionClient } from '@/src/services/execution/execution.js';

type ExecutionRequestWithdrawals = NonNullable<
  Block['data']['message']['body']['execution_requests']
>['withdrawals'];

/**
 * SlotController - Business logic layer for slot-related operations
 */
export class SlotController extends SlotControllerHelpers {
  constructor(
    private readonly slotStorage: SlotStorage,
    private readonly epochStorage: EpochStorage,
    private readonly beaconClient: BeaconClient,
    private readonly beaconTime: BeaconTime,
    private readonly executionClient: ExecutionClient,
  ) {
    super();
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
   * Get slot by number with processing data
   * TODO: why is this needed? The epoch should create the slots and we shouldn't reach to this point
   * if the slot is not created yet.
   */
  async getSlot(slot: number) {
    return this.slotStorage.getSlot(slot);
  }

  /**
   * Get the last processed slot number
   */
  async getLastProcessedSlot(): Promise<number | null> {
    return this.slotStorage.getLastProcessedSlot();
  }

  /**
   * Get the slot processing status for an epoch.
   * Returns semantic information about whether there's a slot to process
   * and whether all slots in the epoch are fully processed.
   *
   * This method is robust against the case where slots haven't been created yet,
   * distinguishing between "no slots exist" and "all slots are processed".
   */
  async getEpochSlotsStatus(startSlot: number, endSlot: number) {
    return this.slotStorage.getEpochSlotsStatus(startSlot, endSlot);
  }

  /**
   * Wait until a slot is ready to be processed.
   * Uses beaconTime to calculate exact wait time including delay slots to head.
   */
  async waitUntilSlotReady(slot: number) {
    await this.beaconTime.waitUntilSlotStart(slot);
  }

  /**
   * Fetch beacon block data for a slot.
   */
  async fetchBeaconBlock(slot: number) {
    return this.beaconClient.getBlock(slot);
  }

  /**
   * Start fetching block rewards before the slot reaches the normal processing path.
   */
  prefetchBlockRewards(slot: number) {
    this.beaconClient.prefetchBlockRewards(slot);
  }

  /**
   * Process attestations for a slot
   * Checks if already processed before processing.
   * Throws an error if committee sizes are not available for all slots.
   */
  async processAttestations(slotNumber: number, attestations: Attestation[]) {
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

    // A block can legitimately have 0 attestations (e.g. network partition,
    // proposer issue, or post-fork startup). Mark as processed and return.
    if (filteredAttestations.length === 0) {
      await this.slotStorage.saveSlotAttestations([], slotNumber);
      return;
    }

    // get committee sizes for attestations
    const committeesCountInSlot = await this.getCommitteeSizesForAttestations(
      slotNumber,
      filteredAttestations,
    );

    // Process each attestation and calculate delays in memory.
    const processedAttestations = [];
    for (const attestation of filteredAttestations) {
      processedAttestations.push(
        ...this.processAttestation(slotNumber, attestation, committeesCountInSlot),
      );
    }

    // Remove duplicates and keep the one with minimum delay
    const deduplicatedAttestations = this.deduplicateAttestations(processedAttestations);

    // Update hourly validator data/stats with attestation delays
    await this.slotStorage.saveSlotAttestations(deduplicatedAttestations, slotNumber);
  }

  /**
   * Fetch and save block rewards for a slot.
   * Checks if already fetched before processing.
   */
  async fetchBlockRewards(slot: number) {
    const isAlreadyFetched = await this.slotStorage.areSlotConsensusRewardsFetched(slot);
    if (isAlreadyFetched) {
      return;
    }

    const blockRewards = await this.beaconClient.getBlockRewards(slot);

    const reward = this.prepareBlockRewards(blockRewards);

    if (!reward) {
      throw new Error('Block reward is required');
    }

    await this.slotStorage.saveBlockRewards(slot, reward);
  }

  /**
   * Fetch execution layer rewards for a slot.
   * Checks if already fetched before processing.
   */
  async fetchExecutionRewards(slot: number, blockNumber: number) {
    const isAlreadyFetched = await this.slotStorage.areExecutionRewardsFetched(slot);
    if (isAlreadyFetched) {
      return;
    }

    const blockInfo = await this.executionClient.getBlock(blockNumber);
    await this.slotStorage.saveExecutionRewardsAndUpdateSlot(
      slot,
      blockInfo.amount,
      blockInfo.address,
      blockInfo.blockNumber,
    );
  }

  /**
   * Start fetching sync committee rewards before the slot reaches the normal processing path.
   */
  async prefetchSyncCommitteeRewards(slot: number) {
    const epoch = this.beaconTime.getEpochFromSlot(slot);
    const syncCommitteeValidators = await this.slotStorage.getSyncCommitteeValidators(epoch);
    if (syncCommitteeValidators.length === 0) {
      // No validators in sync committee for this epoch, skip prefetching rewards
      return;
    }

    this.beaconClient.prefetchSyncCommitteeRewards(slot, syncCommitteeValidators);
  }

  /**
   * Fetch and save sync committee rewards for a slot.
   * Checks if already fetched before processing.
   * Sync committee validators are fetched from the database (guaranteed to exist by epoch processor).
   */
  /**
   * Fetch and process sync committee rewards for a slot
   */
  async fetchSyncCommitteeRewards(slot: number) {
    const isSyncCommitteeFetched = await this.slotStorage.isSyncCommitteeFetchedForSlot(slot);
    if (isSyncCommitteeFetched) {
      return;
    }

    const epoch = this.beaconTime.getEpochFromSlot(slot);
    const syncCommitteeValidators = (await this.slotStorage.getSyncCommitteeValidators(
      epoch,
    )) as string[];

    // Fetch sync committee rewards from beacon chain
    const syncCommitteeRewards = await this.beaconClient.getSyncCommitteeRewards(
      slot,
      syncCommitteeValidators,
    );

    // Prepare sync committee rewards for processing
    const processedRewards = this.prepareSyncCommitteeRewards(syncCommitteeRewards, slot);

    if (processedRewards.length === 0) {
      throw new Error('Sync committee rewards are required');
    }

    // Process sync committee rewards and aggregate into hourly data
    await this.slotStorage.saveSyncRewards(slot, processedRewards);
  }

  /**
   * Process execution payload withdrawals and save them to the database
   * Checks if already processed before processing.
   */
  async processEpWithdrawals(
    slot: number,
    withdrawals: Block['data']['message']['body']['execution_payload']['withdrawals'],
  ) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.epWithdrawalsFetched) {
      return;
    }

    await this.slotStorage.saveValidatorWithdrawals(
      baseSlot.slot,
      withdrawals.map((withdrawal) => ({
        withdrawalIndex: BigInt(withdrawal.index),
        slot: baseSlot.slot,
        validatorIndex: Number(withdrawal.validator_index),
        amount: BigInt(withdrawal.amount),
      })),
    );
  }

  /**
   * Process deposits from beacon block body
   * Checks if already processed before processing.
   */
  async processDeposits(slot: number, deposits: Block['data']['message']['body']['deposits']) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.depositsFetched) {
      return;
    }

    await this.slotStorage.saveBodyDeposits(
      baseSlot.slot,
      deposits.map((deposit, depositIndex) => ({
        slot: baseSlot.slot,
        source: 'd',
        pubkey: deposit.data.pubkey,
        withdrawalCredentials: deposit.data.withdrawal_credentials,
        amount: BigInt(deposit.data.amount),
        index: depositIndex,
      })),
    );
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
   * Process voluntary exits from beacon block
   * Checks if already processed before processing.
   */
  async processVoluntaryExits(
    slot: number,
    voluntaryExits: Block['data']['message']['body']['voluntary_exits'],
  ) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.voluntaryExitsFetched) {
      return;
    }

    await this.slotStorage.saveValidatorExits(
      baseSlot.slot,
      voluntaryExits.map((exit) => ({
        index: Number(exit.message.validator_index),
        epoch: Number(exit.message.epoch),
        slot: baseSlot.slot,
        event: 'voluntary' as const,
      })),
    );
  }

  /**
   * Process execution requests deposits
   * Checks if already processed before processing.
   */
  async processErDeposits(
    slot: number,
    deposits: NonNullable<Block['data']['message']['body']['execution_requests']>['deposits'],
  ) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.erDepositsFetched) {
      return;
    }

    await this.slotStorage.saveValidatorDeposits(
      baseSlot.slot,
      deposits.map((deposit) => ({
        slot: baseSlot.slot,
        source: 'e',
        pubkey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawal_credentials,
        index: Number(deposit.index),
        amount: BigInt(deposit.amount),
      })),
    );
  }

  /**
   * Process execution requests withdrawals
   * Checks if already processed before processing.
   */
  async processErWithdrawals(slot: number, withdrawals: ExecutionRequestWithdrawals) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.erWithdrawalsFetched) {
      return;
    }

    const validatorRows = await this.slotStorage.getValidatorIndexesByPubkeys(
      withdrawals.map((withdrawal) => withdrawal.validator_pubkey),
    );
    const validatorIndexByPubkey = new Map(
      validatorRows.flatMap((validator) =>
        validator.pubkey ? [[validator.pubkey, validator.id] as const] : [],
      ),
    );

    // Requests that do not resolve to indexed validators cannot affect monitored validators.
    const resolvedWithdrawals = withdrawals.flatMap((withdrawal, requestIndex) => {
      const validatorIndex = validatorIndexByPubkey.get(withdrawal.validator_pubkey);
      if (validatorIndex === undefined) {
        return [];
      }

      return [
        {
          slot: baseSlot.slot,
          requestIndex,
          sourceAddress: withdrawal.source_address,
          validatorIndex,
          amount: BigInt(withdrawal.amount),
        },
      ];
    });

    await this.slotStorage.saveValidatorWithdrawalsRequests(baseSlot.slot, resolvedWithdrawals);
  }

  /**
   * Process execution requests consolidations
   * Checks if already processed before processing.
   */
  async processErConsolidations(
    slot: number,
    consolidations: NonNullable<
      Block['data']['message']['body']['execution_requests']
    >['consolidations'],
  ) {
    const baseSlot = await this.slotStorage.getBaseSlot(slot);
    if (baseSlot.erConsolidationsFetched) {
      return;
    }

    await this.slotStorage.saveValidatorConsolidationsRequests(
      baseSlot.slot,
      consolidations.map((consolidation, requestIndex) => ({
        slot: baseSlot.slot,
        requestIndex,
        sourceAddress: consolidation.source_address,
        sourcePubkey: consolidation.source_pubkey,
        targetPubkey: consolidation.target_pubkey,
      })),
    );
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
