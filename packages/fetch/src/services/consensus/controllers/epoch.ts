import chunk from 'lodash/chunk.js';

import { EpochControllerHelpers } from './helpers/epochControllerHelpers.js';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { getUTCDatetimeRoundedToHour } from '@/src/utils/date/index.js';

export class EpochController extends EpochControllerHelpers {
  static readonly maxUnprocessedEpochs: number = 5;

  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly epochStorage: EpochStorage,
    private readonly validatorsStorage: ValidatorsStorage,
    private readonly beaconTime: BeaconTime,
  ) {
    super();
  }

  // TODO: getter to know if an epoch is already processed (all the flags are true)
  // TODO: setter to set the last epoch processed, check all the flags are true

  async getMaxEpoch() {
    const result = await this.epochStorage.getMaxEpoch();
    return result?.epoch ?? null;
  }

  async getMinEpochToProcess() {
    return this.epochStorage.getMinEpochToProcess();
  }

  getBeaconTime() {
    return this.beaconTime;
  }

  async getUnprocessedCount() {
    return this.epochStorage.getUnprocessedCount();
  }

  async getAllEpochs() {
    return this.epochStorage.getAllEpochs();
  }

  async getEpochCount() {
    return this.epochStorage.getEpochCount();
  }

  async getEpochByNumber(epoch: number) {
    return this.epochStorage.getEpochByNumber(epoch);
  }

  /**
   * Check if sync committee for a specific epoch is already fetched
   */
  async isSyncCommitteeForEpochInDB(epoch: number) {
    return this.epochStorage.isSyncCommitteeForEpochInDB(epoch);
  }

  // New method that handles the complete epoch creation logic internally
  async createEpochsIfNeeded() {
    try {
      // Get the last created epoch
      const lastEpoch = await this.getMaxEpoch();
      const unprocessedCount = await this.epochStorage.getUnprocessedCount();

      // Get epochs to create based on the last epoch
      const epochsToCreate = this.getEpochsToCreate(
        unprocessedCount,
        lastEpoch,
        this.beaconClient.slotStartIndexing,
        EpochController.maxUnprocessedEpochs,
      );

      // If there are epochs to create, create them
      if (epochsToCreate.length > 0) {
        await this.epochStorage.createEpochs(epochsToCreate);
      }
    } catch (error) {
      // Log error but don't throw to prevent machine from stopping
      console.error('Error in createEpochsIfNeeded:', error);
    }
  }

  /**
   * Fetch and process epoch rewards in a single atomic transaction.
   *
   * 1. Fetches rewards from the beacon chain in batches
   * 2. Processes and calculates missed rewards using ideal rewards
   * 3. Directly aggregates rewards into HourlyValidatorData and HourlyValidatorStats
   * 4. Marks epoch as rewardsFetched = true
   *
   * The old EpochRewards table is no longer used, and rewards are stored directly
   * in HourlyValidatorData.epochRewards using the format:
   * 'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity'
   * comma separated
   */
  async fetchEpochRewards(epoch: number) {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    if (epochDb?.rewardsFetched) {
      return { success: true, skipped: true };
    }

    // Get all attesting validators from storage
    const attestingValidatorsIds = await this.validatorsStorage.getAttestingValidatorsIds();

    // Create ideal rewards lookup, used to calculate missed rewards
    let idealRewardsLookup: ReturnType<typeof this.createIdealRewardsLookup> | null = null;

    const allProcessedRewards: Array<{
      validatorIndex: number;
      clRewards: bigint;
      clMissedRewards: bigint;
      rewards: string; // Format: 'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity'
    }> = [];

    // Fetch rewards in batches and process them
    const validatorBatches = chunk(attestingValidatorsIds, 1000000);
    for (const batch of validatorBatches) {
      // Get effective balances for the validators
      // used to calculate missed rewards based on ideal rewards
      const validatorsBalances = await this.validatorsStorage.getValidatorsBalances(batch);
      const validatorsBalancesMap = new Map(
        validatorsBalances.map((balance) => [
          balance.id.toString(),
          balance.balance?.toString() || '0',
        ]),
      );

      // Fetch the beacon chain to get the rewards for this batch
      const epochRewards = await this.beaconClient.getAttestationRewards(epoch, batch);

      // Create ideal-rewards lookup if this is the first batch
      // ideal-rewards is for the epoch, so we only need to do it once
      if (!idealRewardsLookup) {
        idealRewardsLookup = this.createIdealRewardsLookup(epochRewards.data.ideal_rewards);
      }

      // Process rewards: get validator balances, find ideal rewards by balance,
      // calculate missed rewards (ideal - actual), and format for new storage strategy
      const epochRewardsData = this.processEpochReward(
        epochRewards.data.total_rewards,
        validatorsBalancesMap,
        idealRewardsLookup!,
        epoch,
      );

      allProcessedRewards.push(...epochRewardsData);
    }

    // Calculate datetime for hourly aggregation using BeaconTime
    const epochTimestamp = this.beaconTime.getTimestampFromEpochNumber(epoch);
    const datetime = getUTCDatetimeRoundedToHour(epochTimestamp);

    // Process and aggregate rewards in a single atomic transaction
    await this.epochStorage.processEpochRewardsAndAggregate(epoch, datetime, allProcessedRewards);
  }

  /**
   * Fetch committees for a specific epoch
   */
  async fetchCommittees(epoch: number): Promise<void> {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    if (epochDb?.committeesFetched) {
      return;
    }

    // Get committees from beacon chain
    const committees = await this.beaconClient.getCommittees(epoch);

    // Prepare data for storage
    const { newSlots, newCommittees, committeesCountInSlot } = this.prepareCommitteeData(
      committees,
      this.beaconTime.getLookbackSlot(),
    );

    // Save to database
    await this.epochStorage.saveCommitteesData(
      epoch,
      newSlots,
      newCommittees,
      committeesCountInSlot,
    );
  }

  async processValidatorProposerDuties(epoch: number) {
    // if already fetched, return
    const isValidatorProposerDutiesFetched =
      await this.epochStorage.isValidatorProposerDutiesFetched(epoch);
    if (isValidatorProposerDutiesFetched) {
      return;
    }

    // fetch validator proposer duties from beacon chain
    const validatorProposerDuties = await this.beaconClient.getValidatorProposerDuties(epoch);

    // save validator proposer duties to database
    await this.epochStorage.saveValidatorProposerDuties(
      epoch,
      validatorProposerDuties.map((duty) => ({
        validatorIndex: Number(duty.validator_index),
        slot: Number(duty.slot),
      })),
    );
  }

  /**
   * Fetch sync committees for a specific epoch
   */
  async fetchSyncCommittees(epoch: number): Promise<void> {
    const result = await this.isSyncCommitteeForEpochInDB(epoch);
    if (result.isFetched) {
      await this.epochStorage.updateSyncCommitteesFetched(epoch);
      return;
    }

    // Get sync committee period start epoch
    const periodStartEpoch = this.beaconTime.getSyncCommitteePeriodStartEpoch(epoch);

    // Get sync committees from beacon chain
    const syncCommitteeData = await this.beaconClient.getSyncCommittees(periodStartEpoch);

    // Calculate the end epoch for this sync committee period
    const toEpoch = periodStartEpoch + 256 - 1; // epochsPerSyncCommitteePeriod - 1
    // Save to database
    await this.epochStorage.saveSyncCommittees(epoch, periodStartEpoch, toEpoch, syncCommitteeData);
  }

  /**
   * Update the epoch's slotsFetched flag to true
   * This flag represents that all the slots for the epoch have been processed
   */
  async updateSlotsFetched(epoch: number): Promise<void> {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    if (epochDb?.allSlotsProcessed) {
      return;
    }
    await this.epochStorage.setAllSlotsProcessed(epoch);
  }

  /**
   * Update the epoch's syncCommitteesFetched flag to true
   * Sync committees are fetched in batches of 256 epochs
   * We fetch sync committees only the first time, and when we do the flag is updated
   * But when the sync committees are fetched, we need to update the flag to true
   * So the guards that check if all the epoch steps have been processed can work
   */
  async updateSyncCommitteesFetched(epoch: number) {
    return this.epochStorage.updateSyncCommitteesFetched(epoch);
  }

  async markEpochAsProcessed(epoch: number): Promise<void> {
    await this.epochStorage.markEpochAsProcessed(epoch);
  }

  /**
   * Check if validators balances are already fetched
   */
  async isValidatorsBalancesFetched(epoch: number): Promise<boolean> {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    return epochDb?.validatorsBalancesFetched ?? false;
  }

  /**
   * Check if epoch rewards are already fetched
   */
  async isRewardsFetched(epoch: number): Promise<boolean> {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    return epochDb?.rewardsFetched ?? false;
  }

  /**
   * Check if validators activation tracking is complete
   */
  async isValidatorsActivationFetched(epoch: number): Promise<boolean> {
    const epochDb = await this.epochStorage.getEpochByNumber(epoch);
    return epochDb?.validatorsActivationFetched ?? false;
  }

  /**
   * Fetch epoch rewards
   * Returns early if already processed
   */
  async fetchRewards(epoch: number): Promise<void> {
    if (await this.isRewardsFetched(epoch)) {
      return;
    }
    await this.fetchEpochRewards(epoch);
  }

  /**
   * Mark validators activation as fetched
   */
  async markValidatorsActivationFetched(epoch: number): Promise<void> {
    await this.epochStorage.updateValidatorsActivationFetched(epoch);
  }
}
