import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { Validator } from '@beacon-indexer/db';

import { GetValidators } from '../../types.js';

export abstract class ValidatorControllerHelpers {
  static mapValidatorDataToDBEntity(validatorData: GetValidators['data'][number]): Validator {
    return {
      id: +validatorData.index,
      withdrawalAddress: validatorData.validator.withdrawal_credentials.startsWith('0x')
        ? '0x' + validatorData.validator.withdrawal_credentials.slice(-40)
        : null,
      pubkey: validatorData.validator.pubkey,
      status: VALIDATOR_STATUS[validatorData.status as keyof typeof VALIDATOR_STATUS],
      balance: BigInt(validatorData.balance),
      effectiveBalance: BigInt(validatorData.validator.effective_balance),
    };
  }
}
