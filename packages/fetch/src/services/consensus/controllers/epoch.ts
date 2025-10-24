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

  /**
   * NEW EPOCH REWARDS PROCESSING STRATEGY
   *
   * The epoch rewards processing has been refactored to use a single atomic transaction approach:
   *
   * OLD STRATEGY (deprecated):
   * 1. fetchEpochRewards() -> Save to EpochRewards table
   * 2. aggregateEpochRewardsIntoHourlyValidatorStats() -> Aggregate from EpochRewards to HourlyValidatorStats
   *
   * NEW STRATEGY (current):
   * 1. fetchEpochRewards() -> Process and aggregate directly in single atomic transaction
   *    - Fetches rewards from beacon chain
   *    - Calculates missed rewards using ideal rewards
   *    - Stores epoch rewards in HourlyValidatorData.epochRewards using format:
   *      'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity,...'
   *    - Aggregates rewards into HourlyValidatorStats for clRewards and clMissedRewards
   *    - Marks epoch as rewardsFetched = true
   *
   * BENEFITS:
   * - Single atomic transaction ensures data consistency
   * - Eliminates intermediate EpochRewards table
   * - Removes rewardsAggregated flag (no longer needed)
   * - Better performance with fewer database operations
   * - Simplified state management
   */

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

  async markEpochAsProcessed(epoch: number) {
    await this.epochStorage.markEpochAsProcessed(epoch);
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
  async fetchCommittees(epoch: number) {
    // Get committees from beacon chain
    const committees = await this.beaconClient.getCommittees(epoch);

    // Prepare data for storage
    const { newSlots, newCommittees, committeesCountInSlot } = this.prepareCommitteeData(
      committees,
      this.beaconTime.getSlotStartIndexing(),
    );

    // Save to database
    await this.epochStorage.saveCommitteesData(
      epoch,
      newSlots,
      newCommittees,
      committeesCountInSlot,
    );
  }

  /**
   * Fetch sync committees for a specific epoch
   */
  async fetchSyncCommittees(epoch: number) {
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
   * Check if sync committee for a specific epoch is already fetched
   */
  async checkSyncCommitteeForEpoch(epoch: number) {
    return this.epochStorage.checkSyncCommitteeForEpoch(epoch);
  }

  // From here on
  // TODO: do we really need this? Should this be part of another atomic transaction?

  /**
   * Update the epoch's slotsFetched flag to true
   */
  async updateSlotsFetched(epoch: number) {
    return this.epochStorage.updateSlotsFetched(epoch);
  }

  /**
   * Update the epoch's syncCommitteesFetched flag to true
   */
  async updateSyncCommitteesFetched(epoch: number) {
    return this.epochStorage.updateSyncCommitteesFetched(epoch);
  }

  /**
   * Get hourly validator attestation stats for specific validators and datetime
   * @internal
   */
  async getHourlyValidatorAttestationStats(validatorIndexes: number[], datetime: Date) {
    return this.epochStorage.getHourlyValidatorAttestationStats(validatorIndexes, datetime);
  }

  /**
   * Get all hourly validator attestation stats for a specific datetime
   * @internal
   */
  async getAllHourlyValidatorAttestationStats(datetime: Date) {
    return this.epochStorage.getAllHourlyValidatorAttestationStats(datetime);
  }
}
