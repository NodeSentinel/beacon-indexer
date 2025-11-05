import { Validator } from '@beacon-indexer/db';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';

type ValidatorDataInput = {
  index: string;
  balance: string;
  status: string;
  validator: {
    withdrawal_credentials: string;
    effective_balance: string;
  };
};

export abstract class ValidatorControllerHelpers {
  static mapValidatorDataToDBEntity(validatorData: ValidatorDataInput): Validator {
    return {
      id: +validatorData.index,
      withdrawalAddress: validatorData.validator.withdrawal_credentials.startsWith('0x')
        ? '0x' + validatorData.validator.withdrawal_credentials.slice(-40)
        : null,
      status: VALIDATOR_STATUS[validatorData.status as keyof typeof VALIDATOR_STATUS],
      balance: BigInt(validatorData.balance),
      effectiveBalance: BigInt(validatorData.validator.effective_balance),
      pubkey: null,
    };
  }
}
