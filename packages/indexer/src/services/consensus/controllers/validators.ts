import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import chunk from 'lodash/chunk.js';

import { ValidatorControllerHelpers } from './helpers/validatorControllerHelpers.js';

import createLogger from '@/src/lib/pino.js';
import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';

export class ValidatorsController {
  private readonly logger = createLogger('ValidatorsController');

  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly validatorsStorage: ValidatorsStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  /**
   * Initialize validators with wait for slot start.
   * Waits until the lookback slot is ready, then initializes validators if needed.
   * Includes logging for wait status and initialization results.
   */
  async initValidatorsWithWait(lookbackSlot: number): Promise<void> {
    try {
      // Check if we need to wait for the slot to start
      const hasSlotStarted = this.beaconTime.hasSlotStarted(lookbackSlot);
      if (!hasSlotStarted) {
        this.logger.info(
          `Waiting for slot ${lookbackSlot} to start before fetching validator data`,
        );
        await this.beaconTime.waitUntilSlotStart(lookbackSlot);
        this.logger.info(
          `Slot ${lookbackSlot} is now ready, proceeding with validator initialization`,
        );
      } else {
        this.logger.info(
          `Slot ${lookbackSlot} has already started, proceeding with validator initialization`,
        );
      }

      await this.initValidators(lookbackSlot);
      this.logger.info('Validators initialization completed successfully');
    } catch (error) {
      this.logger.error(`Error initializing validators for slot ${lookbackSlot}`, {
        error,
        lookbackSlot,
      });
      throw error;
    }
  }

  async initValidators(lookbackSlot: number) {
    const count = await this.validatorsStorage.getValidatorsCount();
    if (count > 0) {
      this.logger.info(`Validators already initialized (count: ${count}), skipping initialization`);
      return;
    }

    this.logger.info(`Starting validators initialization for lookback slot ${lookbackSlot}`);

    const batchSize = 1_000_000;
    let allValidatorsData: Awaited<ReturnType<typeof this.beaconClient.getValidators>> = [];
    let currentValidatorIndex = 0;
    let hasMore = true;
    let batchNumber = 0;

    // Keep fetching validators in batches until we get fewer results than batchSize
    while (hasMore) {
      batchNumber++;
      // Generate batch of validator indices starting from currentValidatorIndex
      const batchIndexes = Array.from({ length: batchSize }, (_, i) =>
        String(currentValidatorIndex + i),
      );

      this.logger.debug(
        `Fetching validator batch ${batchNumber} starting from index ${currentValidatorIndex}`,
      );

      const batchResult = await this.beaconClient.getValidators(lookbackSlot, batchIndexes, null);

      // Use concat instead of push with spread operator to avoid stack overflow
      allValidatorsData = allValidatorsData.concat(batchResult);

      // If we get fewer results than batchSize, we have reached the end
      hasMore = batchResult.length === batchSize;

      this.logger.debug(
        `Batch ${batchNumber} completed: fetched ${batchResult.length} validators (total: ${allValidatorsData.length})`,
      );

      // Move to next batch only when there are more validators to fetch
      if (hasMore) {
        currentValidatorIndex += batchSize;
      }
    }

    this.logger.info(`Saving ${allValidatorsData.length} validators to database`);
    await this.validatorsStorage.saveValidators(
      allValidatorsData.map((data) => ValidatorControllerHelpers.mapValidatorDataToDBEntity(data)),
    );
    this.logger.info(`Successfully saved ${allValidatorsData.length} validators to database`);
  }

  /**
   * Get max validator index from database
   */
  async getMaxValidatorIndex() {
    return this.validatorsStorage.getMaxValidatorIndex();
  }

  /**
   * Get final state validator indices from database
   */
  async getFinalValidatorIndexes() {
    return this.validatorsStorage.getFinalValidatorIndexes();
  }

  /**
   * Get attesting validator indices from database
   */
  async getAttestingValidatorIndexes() {
    return this.validatorsStorage.getAttestingValidatorIndexes();
  }

  /**
   * Get validator balances for specific validator indices
   */
  async getValidatorsBalances(validatorIndexes: number[]) {
    return this.validatorsStorage.getValidatorsBalances(validatorIndexes);
  }

  /**
   * Get pending validators for tracking
   */
  async getPendingValidators(): Promise<Array<{ id: number }>> {
    return this.validatorsStorage.getPendingValidators();
  }

  /**
   * Save validator balances to database
   */
  async saveValidatorBalances(
    validatorBalances: Array<{ index: string; balance: string }>,
    epoch: number,
  ) {
    return this.validatorsStorage.saveValidatorBalances(validatorBalances, epoch);
  }

  /**
   * Save the full validator state for an epoch.
   */
  async saveValidatorsForEpoch(
    validatorsData: Array<{
      index: string;
      status: string;
      balance: string;
      validator: {
        withdrawal_credentials: string;
        effective_balance: string;
        activation_epoch: string;
      };
    }>,
    epoch: number,
  ) {
    return this.validatorsStorage.saveValidatorsForEpoch(validatorsData, epoch);
  }

  /**
   * Update validators with new data
   */
  async updateValidators(
    validatorsData: Array<{
      index: string;
      status: string;
      balance: string;
      validator: {
        withdrawal_credentials: string;
        effective_balance: string;
        activation_epoch: string;
      };
    }>,
  ): Promise<void> {
    return this.validatorsStorage.updateValidators(validatorsData);
  }

  /**
   * Fetch validator state for a specific slot and persist it for the epoch.
   * The caller must provide the epoch corresponding to the slot to avoid coupling with time utils.
   */
  async fetchValidatorsBalances(slot: number, epoch: number) {
    const totalValidators = await this.validatorsStorage.getMaxValidatorIndex();
    if (totalValidators === 0) {
      return;
    }

    const finalStateValidatorIndexes = await this.validatorsStorage.getFinalValidatorIndexes();
    const finalStateValidatorsSet = new Set(finalStateValidatorIndexes);

    const allValidatorIndexes = Array.from({ length: totalValidators + 1 }, (_, i) => i).filter(
      (id) => !finalStateValidatorsSet.has(id),
    );

    const batchSize = 1_000_000;
    const batches = chunk(allValidatorIndexes, batchSize);
    let allValidatorsData: Array<{
      index: string;
      status: string;
      balance: string;
      validator: {
        withdrawal_credentials: string;
        effective_balance: string;
        activation_epoch: string;
      };
    }> = [];

    for (const batchIds of batches) {
      const batchResult = await this.beaconClient.getValidators(slot, batchIds.map(String), null);

      allValidatorsData = [...allValidatorsData, ...batchResult];

      if (batchResult.length < batchSize) {
        break;
      }
    }

    await this.validatorsStorage.saveValidatorsForEpoch(allValidatorsData, epoch);
  }

  /**
   * Discover new validators that appeared on the beacon chain since the last known index.
   * Fetches validators in batches starting from maxIndex+1 until no more are found.
   */
  async discoverNewValidators(slotId: number) {
    const batchSize = 1000;
    const maxIndex = await this.validatorsStorage.getMaxValidatorIndex();
    let currentIndex = maxIndex + 1;
    let totalDiscovered = 0;
    let hasMore = true;

    while (hasMore) {
      const batchIndexes = Array.from({ length: batchSize }, (_, i) => String(currentIndex + i));

      const batchResult = await this.beaconClient.getValidators(slotId, batchIndexes, null);

      if (batchResult.length === 0) {
        hasMore = false;
        continue;
      }

      await this.validatorsStorage.saveValidators(
        batchResult.map((data) => ValidatorControllerHelpers.mapValidatorDataToDBEntity(data)),
      );

      totalDiscovered += batchResult.length;

      this.logger.info(
        `Discovered ${batchResult.length} new validators (indices ${currentIndex}-${currentIndex + batchResult.length - 1})`,
      );

      hasMore = batchResult.length === batchSize;
      currentIndex += batchSize;
    }

    if (totalDiscovered > 0) {
      this.logger.info(`Total new validators discovered: ${totalDiscovered}`);
    }

    return { success: true, discoveredCount: totalDiscovered };
  }

  /**
   * Track transitioning validators (pending -> active/exited, etc.).
   */
  async trackTransitioningValidators(slotId: number) {
    const pendingValidators = await this.validatorsStorage.getPendingValidators();

    if (pendingValidators.length === 0) {
      return { success: true, processedCount: 0 };
    }

    const validatorIndexes = pendingValidators.map((v) => String(v.id));
    const validatorsData = await this.beaconClient.getValidators(slotId, validatorIndexes, null);

    await this.validatorsStorage.updateValidators(validatorsData);

    return { success: true, processedCount: validatorsData.length };
  }
}
