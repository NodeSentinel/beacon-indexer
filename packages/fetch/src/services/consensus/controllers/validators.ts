import chunk from 'lodash/chunk.js';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { ValidatorsStorage } from '@/src/services/consensus/storage/validators.js';
import { mapValidatorDataToDBEntity } from '@/src/services/consensus/utils/mappers/validatorMapper.js';

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
    let currentValidatorId = 0;

    // Keep fetching validators in batches until we get fewer results than batchSize
    while (true) {
      // Generate batch of validator IDs starting from currentValidatorId
      const batchIds = Array.from({ length: batchSize }, (_, i) => String(currentValidatorId + i));

      const batchResult = await this.beaconClient.getValidators('head', batchIds, null);

      allValidatorsData = [...allValidatorsData, ...batchResult];

      // If we get fewer results than batchSize, we've reached the end
      if (batchResult.length < batchSize) {
        break;
      }

      // Move to next batch
      currentValidatorId += batchSize;
    }

    await this.validatorsStorage.saveValidators(
      allValidatorsData.map((data) => mapValidatorDataToDBEntity(data)),
    );
  }

  /**
   * Get max validator ID from database
   */
  async getMaxValidatorId() {
    return this.validatorsStorage.getMaxValidatorId();
  }

  /**
   * Get final state validator IDs from database
   */
  async getFinalValidatorIds() {
    return this.validatorsStorage.getFinalValidatorIds();
  }

  /**
   * Get attesting validator IDs from database
   */
  async getAttestingValidatorsIds() {
    return this.validatorsStorage.getAttestingValidatorsIds();
  }

  /**
   * Get validator balances for specific validator IDs
   */
  async getValidatorsBalances(validatorIds: number[]) {
    return this.validatorsStorage.getValidatorsBalances(validatorIds);
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
      const totalValidators = await this.validatorsStorage.getMaxValidatorId();
      if (totalValidators === 0) {
        return;
      }

      const finalStateValidatorsIds = await this.validatorsStorage.getFinalValidatorIds();
      const finalStateValidatorsSet = new Set(finalStateValidatorsIds);

      const allValidatorIds = Array.from({ length: totalValidators }, (_, i) => i).filter(
        (id) => !finalStateValidatorsSet.has(id),
      );

      const batchSize = 1_000_000;
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

      await this.validatorsStorage.saveValidatorBalances(allValidatorBalances, epoch);
    } catch (error) {
      console.error(`Error fetching validator balances info`, error);
    }
  }

  /**
   * Track transitioning validators (pending -> active/exited, etc.).
   */
  async trackTransitioningValidators() {
    const pendingValidators = await this.validatorsStorage.getPendingValidators();

    if (pendingValidators.length === 0) {
      return { success: true, processedCount: 0 };
    }

    const validatorIds = pendingValidators.map((v) => String(v.id));
    const validatorsData = await this.beaconClient.getValidators('head', validatorIds, null);

    await this.validatorsStorage.updateValidators(validatorsData);

    return { success: true, processedCount: validatorsData.length };
  }
}
