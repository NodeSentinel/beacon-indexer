import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getMissingValidatorItems,
  parseSavedLidoCsmOperatorId,
  type ValidatorItem,
} from './use-validator-input-utils';

describe('getMissingValidatorItems', () => {
  it('returns validators linked to a Lido CSM operator that are not in the cluster', () => {
    const currentValidators: ValidatorItem[] = [
      {
        id: 'validator-50',
        type: 'index',
        value: '50',
        index: 50,
        displayName: 'Validator #50',
        withdrawalAddress: '0x0000000000000000000000000000000000000050',
      },
    ];

    const missingValidators = getMissingValidatorItems({
      currentValidators,
      idPrefix: 'missing-lido-csm-344',
      searchResults: [
        {
          index: 50,
          pubkey: null,
          withdrawalAddress: '0x0000000000000000000000000000000000000050',
        },
        {
          index: 51,
          pubkey: null,
          withdrawalAddress: '0x0000000000000000000000000000000000000051',
        },
      ],
    });

    assert.deepEqual(
      missingValidators.map((validator) => validator.index),
      [51],
    );
    assert.equal(missingValidators[0].id, 'missing-lido-csm-344-0');
  });
});

describe('parseSavedLidoCsmOperatorId', () => {
  it('keeps operator zero valid while ignoring blank values', () => {
    assert.equal(parseSavedLidoCsmOperatorId('0'), 0);
    assert.equal(parseSavedLidoCsmOperatorId(''), undefined);
    assert.equal(parseSavedLidoCsmOperatorId('   '), undefined);
  });
});
