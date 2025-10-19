import chunk from 'lodash/chunk.js';

import { EpochControllerHelpers } from './helpers/epochControllerHelpers.js';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { EpochStorage } from '@/src/services/consensus/storage/epoch.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { convertToUTC } from '@/src/utils/date/index.js';

export class EpochController extends EpochControllerHelpers {
  static readonly maxUnprocessedEpochs: number = 5;

  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly epochStorage: EpochStorage,
    private readonly beaconTime: BeaconTime,
  ) {
    super();
  }

  async getMaxEpoch() {
    const result = await this.epochStorage.getMaxEpoch();
    return result?.epoch ?? null;
  }

  async getMinEpochToProcess() {
    return this.epochStorage.getMinEpochToProcess();
  }

  async getUnprocessedCount() {
    return this.epochStorage.getUnprocessedCount();
  }

  async markEpochAsProcessed(epoch: number) {
    await this.epochStorage.markEpochAsProcessed(epoch);
  }

  async getAllEpochs() {
    return this.epochStorage.getAllEpochs();
  }

  async getEpochCount() {
    return this.epochStorage.getEpochCount();
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
   * Fetch validator balances for a specific slot
   * Coordinates between beacon client and storage
   */
  async fetchValidatorsBalances(slot: number) {
    try {
      // Get basic validator data from storage
      const totalValidators = await this.epochStorage.getMaxValidatorId();
      if (totalValidators == 0) {
        return;
      }

      // Get final state validators from storage
      const finalStateValidatorsIds = await this.epochStorage.getFinalValidatorIds();
      const finalStateValidatorsSet = new Set(finalStateValidatorsIds);

      // Generate all validator IDs and filter out final state validators
      const allValidatorIds = Array.from({ length: totalValidators }, (_, i) => i).filter(
        (id) => !finalStateValidatorsSet.has(id),
      );

      const batchSize = 1_000_000;

      // Create chunks of batchSize
      const batches = chunk(allValidatorIds, batchSize);
      let allValidatorBalances: Array<{ index: string; balance: string }> = [];

      for (const batchIds of batches) {
        const batchResult = await this.beaconClient.getValidatorsBalances(
          slot,
          batchIds.map((id) => String(id)),
        );

        allValidatorBalances = [...allValidatorBalances, ...batchResult];

        if (batchResult.length < batchSize) {
          break;
        }
      }

      // Save all collected data to database
      const epoch = this.beaconTime.getEpochFromSlot(slot);
      await this.epochStorage.saveValidatorBalances(allValidatorBalances, epoch);
    } catch (error) {
      console.error(`Error fetching validator balances info`, error);
    }
  }

  /**
   * Fetch attestation rewards for a specific epoch
   * Coordinates between beacon client and storage
   */
  async fetchAttestationRewards(epoch: number) {
    const epochTimestamp = this.beaconTime.getTimestampFromEpochNumber(epoch);
    const { date, hour } = convertToUTC(epochTimestamp);

    // Truncate temp table
    await this.epochStorage.truncateAttestationRewardsTempTable();

    // Get all attesting validators from storage
    const allValidatorIds = await this.epochStorage.getAttestingValidatorsIds();

    // Get ideal rewards from storage
    let idealRewardsLookup: ReturnType<typeof this.createIdealRewardsLookup> | null = null;

    // Split all validators in batches
    const validatorBatches = chunk(allValidatorIds, 1000000);

    // Fetch rewards in batches and save in a temp table
    for (const batch of validatorBatches) {
      // Get effective balances for the validators in the batch from storage
      const validatorsBalances = await this.epochStorage.getValidatorsBalances(batch);
      const validatorsBalancesMap = new Map(
        validatorsBalances.map((balance) => [
          balance.id.toString(),
          balance.balance?.toString() || '0',
        ]),
      );

      // Fetch the beacon chain to get the rewards for this batch
      const epochRewards = await this.beaconClient.getAttestationRewards(epoch, batch);

      // Create ideal-rewards lookup if this is the first batch
      if (!idealRewardsLookup) {
        idealRewardsLookup = this.createIdealRewardsLookup(epochRewards.data.ideal_rewards);
      }

      // Process and save rewards in batches
      const rewardBatches = chunk(epochRewards.data.total_rewards, 12_000);
      for (const rewardBatch of rewardBatches) {
        const processedRewards = this.processRewardBatch(
          rewardBatch,
          validatorsBalancesMap,
          idealRewardsLookup!,
          date,
          hour,
        );

        // Transform ProcessedReward to EpochRewardsTempData format
        const epochRewardsTempData = processedRewards.map((reward) => ({
          validatorIndex: reward.validatorIndex,
          hour: reward.hour,
          date: new Date(reward.date),
          head: BigInt(reward.head),
          target: BigInt(reward.target),
          source: BigInt(reward.source),
          inactivity: BigInt(reward.inactivity),
          missedHead: BigInt(reward.missedHead),
          missedTarget: BigInt(reward.missedTarget),
          missedSource: BigInt(reward.missedSource),
          missedInactivity: BigInt(reward.missedInactivity),
        }));

        await this.epochStorage.insertIntoEpochRewardsTemp(epochRewardsTempData);
      }
    }

    // Process temp results and combine them in the main table
    await this.epochStorage.saveAttestationRewardsAndUpdateEpoch(epoch);
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
   * Track transitioning validators
   */
  async trackTransitioningValidators() {
    // Get pending validators from storage
    const pendingValidators = await this.epochStorage.getPendingValidators();

    if (pendingValidators.length === 0) {
      return { success: true, processedCount: 0 };
    }

    // Get validator data from beacon chain
    const validatorIds = pendingValidators.map((v) => String(v.id));
    const validatorsData = await this.beaconClient.getValidators('head', validatorIds, null);

    // Update validators in storage
    await this.epochStorage.updateValidators(validatorsData);

    return { success: true, processedCount: validatorsData.length };
  }
}
