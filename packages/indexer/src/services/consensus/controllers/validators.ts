import chunk from 'lodash/chunk.js';

import { ValidatorControllerHelpers } from './helpers/validatorControllerHelpers.js';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';

export class ValidatorsController {
  constructor(
    private readonly beaconClient: BeaconClient,
    private readonly validatorsStorage: ValidatorsStorage,
  ) {}

  async initValidators() {
    const count = await this.validatorsStorage.getValidatorsCount();
    if (count > 0) {
      return;
    }

    const batchSize = 1_000_000;
    let allValidatorsData: Awaited<ReturnType<typeof this.beaconClient.getValidators>> = [];
    let currentValidatorIndex = 0;
    let hasMore = true;

    // Keep fetching validators in batches until we get fewer results than batchSize
    while (hasMore) {
      // Generate batch of validator indices starting from currentValidatorIndex
      const batchIndexes = Array.from({ length: batchSize }, (_, i) =>
        String(currentValidatorIndex + i),
      );

      const batchResult = await this.beaconClient.getValidators('head', batchIndexes, null);

      allValidatorsData = [...allValidatorsData, ...batchResult];

      // If we get fewer results than batchSize, we have reached the end
      hasMore = batchResult.length === batchSize;

      // Move to next batch only when there are more validators to fetch
      if (hasMore) {
        currentValidatorIndex += batchSize;
      }
    }

    await this.validatorsStorage.saveValidators(
      allValidatorsData.map((data) => ValidatorControllerHelpers.mapValidatorDataToDBEntity(data)),
    );
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
      };
    }>,
  ): Promise<void> {
    return this.validatorsStorage.updateValidators(validatorsData);
  }

  /**
   * Fetch validator balances for a specific slot and persist them.
   * The caller must provide the epoch corresponding to the slot to avoid coupling with time utils.
   */
  async fetchValidatorsBalances(slot: number, epoch: number) {
    try {
      const totalValidators = await this.validatorsStorage.getMaxValidatorIndex();
      if (totalValidators === 0) {
        return;
      }

      const finalStateValidatorIndexes = await this.validatorsStorage.getFinalValidatorIndexes();
      const finalStateValidatorsSet = new Set(finalStateValidatorIndexes);

      const allValidatorIndexes = Array.from({ length: totalValidators }, (_, i) => i).filter(
        (id) => !finalStateValidatorsSet.has(id),
      );

      const batchSize = 1_000_000;
      const batches = chunk(allValidatorIndexes, batchSize);
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

      await this.validatorsStorage.saveValidatorBalances(allValidatorBalances, epoch);
    } catch (error) {
      console.error(`Error fetching validator balances info`, error);
    }
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
