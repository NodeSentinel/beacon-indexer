import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { Validator } from '@beacon-indexer/db';

import { GetValidators } from '../../types.js';

const FAR_FUTURE_EPOCH = '18446744073709551615';

export abstract class ValidatorControllerHelpers {
  static parseEpoch(raw: string): number | null {
    if (!raw || raw === FAR_FUTURE_EPOCH) return null;
    return +raw;
  }

  static mapValidatorDataToDBEntity(validatorData: GetValidators['data'][number]): Validator {
    return {
      id: +validatorData.index,
      withdrawalAddress: validatorData.validator.withdrawal_credentials.startsWith('0x')
        ? '0x' + validatorData.validator.withdrawal_credentials.slice(-40)
        : null,
      withdrawalCredentialsPrefix: validatorData.validator.withdrawal_credentials.slice(0, 4),
      pubkey: validatorData.validator.pubkey,
      status: VALIDATOR_STATUS[validatorData.status as keyof typeof VALIDATOR_STATUS],
      balance: BigInt(validatorData.balance),
      effectiveBalance: BigInt(validatorData.validator.effective_balance),
      activationEpoch: ValidatorControllerHelpers.parseEpoch(
        validatorData.validator.activation_epoch,
      ),
    };
  }
}
