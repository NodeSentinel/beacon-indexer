import { Decimal } from '@prisma/client/runtime/library';
import chunk from 'lodash/chunk.js';

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
    const totalValidators = 5_000_000;

    // Generate all validator IDs and filter out final state validators
    const allValidatorIds = Array.from({ length: totalValidators }, (_, i) => i);

    // Create chunks of batchSize
    const batches = chunk(allValidatorIds, batchSize);
    let allValidatorsData: Awaited<ReturnType<typeof this.beaconClient.getValidators>> = [];
    for (const batchIds of batches) {
      const batchResult = await this.beaconClient.getValidators(
        'head',
        batchIds.map((id) => String(id)),
        null,
      );

      allValidatorsData = [...allValidatorsData, ...batchResult];

      if (batchResult.length < batchSize) {
        break;
      }
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
}
