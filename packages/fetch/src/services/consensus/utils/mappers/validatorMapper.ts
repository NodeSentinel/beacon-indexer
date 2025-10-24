import { Decimal, Validator } from '@beacon-indexer/db';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';
import { GetValidators } from '@/src/services/consensus/types.js';

/**
 * Map validator data from beacon API response to database entity format
 * Handles both API response format and mock data format
 */
export function mapValidatorDataToDBEntity(
  validatorData:
    | GetValidators['data'][0]
    | {
        index: string;
        balance: string;
        status: string;
        validator: {
          pubkey: string;
          withdrawal_credentials: string;
          effective_balance: string;
          slashed: boolean | string;
          activation_eligibility_epoch: string;
          activation_epoch: string;
          exit_epoch: string;
          withdrawable_epoch: string;
        };
      },
): Validator {
  return {
    id: +validatorData.index,
    withdrawalAddress: validatorData.validator.withdrawal_credentials.startsWith('0x')
      ? '0x' + validatorData.validator.withdrawal_credentials.slice(-40)
      : null,
    status: VALIDATOR_STATUS[validatorData.status as keyof typeof VALIDATOR_STATUS],
    balance: BigInt(validatorData.balance),
    effectiveBalance: BigInt(validatorData.validator.effective_balance),
  };
}
