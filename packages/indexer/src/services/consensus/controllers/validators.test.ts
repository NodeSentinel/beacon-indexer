import { describe, expect, it, vi } from 'vitest';

import { ValidatorsController } from './validators.js';

describe('ValidatorsController', () => {
  it('refreshes full validator state for an epoch using the validators endpoint', async () => {
    // Beacon client exposes both endpoints, but the epoch refresh should use the
    // full validator payload so effective balance and status stay in sync.
    const beaconClient = {
      getValidators: vi.fn().mockResolvedValue([
        {
          index: '1',
          balance: '31900000000',
          status: 'active_ongoing',
          validator: {
            pubkey: '0x01',
            withdrawal_credentials:
              '0x0100000000000000000000001111111111111111111111111111111111111111',
            effective_balance: '31000000000',
            slashed: 'false',
            activation_eligibility_epoch: '0',
            activation_epoch: '10',
            exit_epoch: '18446744073709551615',
            withdrawable_epoch: '18446744073709551615',
          },
        },
      ]),
      getValidatorsBalances: vi.fn(),
    };

    // Storage should receive the full validator payload and mark the epoch as fetched.
    const validatorsStorage = {
      getMaxValidatorIndex: vi.fn().mockResolvedValue(1),
      getFinalValidatorIndexes: vi.fn().mockResolvedValue([]),
      saveValidatorsForEpoch: vi.fn().mockResolvedValue(undefined),
    };

    const controller = new ValidatorsController(
      beaconClient as never,
      validatorsStorage as never,
      {} as never,
    );

    await controller.fetchValidatorsBalances(320, 10);

    expect(beaconClient.getValidators).toHaveBeenCalledWith(320, ['0', '1'], null);
    expect(beaconClient.getValidatorsBalances).not.toHaveBeenCalled();
    expect(validatorsStorage.saveValidatorsForEpoch).toHaveBeenCalledWith(
      [
        {
          index: '1',
          balance: '31900000000',
          status: 'active_ongoing',
          validator: {
            pubkey: '0x01',
            withdrawal_credentials:
              '0x0100000000000000000000001111111111111111111111111111111111111111',
            effective_balance: '31000000000',
            slashed: 'false',
            activation_eligibility_epoch: '0',
            activation_epoch: '10',
            exit_epoch: '18446744073709551615',
            withdrawable_epoch: '18446744073709551615',
          },
        },
      ],
      10,
    );
  });
});
