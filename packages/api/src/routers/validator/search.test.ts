import { describe, expect, it, vi } from 'vitest';

import { searchValidators } from './search.js';

const validator = {
  index: 1,
  pubkey: `0x${'11'.repeat(48)}`,
  withdrawalAddress: '0x1234567890123456789012345678901234567890',
};

/** Creates a complete validator storage mock for search helper tests. */
function createValidatorStorageMock(overrides = {}) {
  return {
    findByIndex: vi.fn(),
    findByIndexes: vi.fn(),
    findByPubkey: vi.fn(),
    findByPubkeys: vi.fn(),
    findByWithdrawalAddress: vi.fn(),
    findByWithdrawalAddresses: vi.fn(),
    ...overrides,
  };
}

describe('searchValidators', () => {
  // Verifies that a single validator index search uses the storage lookup by index.
  it('resolves a validator by index', async () => {
    const findByIndex = vi.fn().mockResolvedValue(validator);

    const validators = await searchValidators({
      chain: 'ethereum',
      executionRpcUrl: 'https://execution.example.com',
      input: { index: validator.index },
      validatorStorage: createValidatorStorageMock({
        findByIndex,
      }),
    });

    expect(findByIndex).toHaveBeenCalledWith(validator.index);
    expect(validators).toEqual([validator]);
  });

  // Verifies that an Ethereum Lido CSM search resolves operator pubkeys before loading validators.
  it('resolves Ethereum Lido CSM operator pubkeys into validators', async () => {
    const findByPubkeys = vi.fn().mockResolvedValue([validator]);
    const resolveLidoPubkeys = vi.fn().mockResolvedValue([validator.pubkey]);

    const validators = await searchValidators({
      chain: 'ethereum',
      executionRpcUrl: 'https://execution.example.com',
      input: { lidoCsmOperatorId: 123 },
      resolveLidoPubkeys,
      validatorStorage: createValidatorStorageMock({
        findByPubkeys,
      }),
    });

    expect(resolveLidoPubkeys).toHaveBeenCalledWith({
      operatorId: 123,
      rpcUrl: 'https://execution.example.com',
    });
    expect(findByPubkeys).toHaveBeenCalledWith([validator.pubkey]);
    expect(validators).toEqual([validator]);
  });

  // Verifies that Lido CSM searches are rejected for chains without Lido CSM support.
  it('rejects Lido CSM searches on non-Ethereum chains', async () => {
    await expect(
      searchValidators({
        chain: 'gnosis',
        executionRpcUrl: 'https://execution.example.com',
        input: { lidoCsmOperatorId: 123 },
        resolveLidoPubkeys: vi.fn(),
        validatorStorage: createValidatorStorageMock(),
      }),
    ).rejects.toThrow('Lido CSM validator search is only supported on Ethereum');
  });
});
