import { Decimal } from '@beacon-indexer/db';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';
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
      allValidatorsData.map((data) => ({
        id: +data.index,
        withdrawalAddress: data.validator.withdrawal_credentials.startsWith('0x')
          ? '0x' + data.validator.withdrawal_credentials.slice(-40)
          : null,
        status: VALIDATOR_STATUS[data.status],
        balance: new Decimal(data.balance),
        effectiveBalance: new Decimal(data.validator.effective_balance),
      })),
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
}
