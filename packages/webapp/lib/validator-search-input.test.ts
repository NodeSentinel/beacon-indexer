import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseValidatorSearchInput } from './validator-search-input';

describe('parseValidatorSearchInput', () => {
  it('treats numeric input as invalid when the pubkey category is selected', () => {
    const result = parseValidatorSearchInput('123', 'pubkey');

    assert.ok(result);
    assert.equal(result.type, 'pubkey');
    assert.deepEqual(result.values, []);
    assert.deepEqual(result.invalidValues, ['123']);
  });

  it('parses comma-separated validator indexes when the index category is selected', () => {
    const result = parseValidatorSearchInput('123, 456', 'index');

    assert.ok(result);
    assert.equal(result.type, 'index');
    assert.deepEqual(result.values, ['123', '456']);
    assert.deepEqual(result.invalidValues, []);
  });
});
