import { describe, expect, it, vi } from 'vitest';

import { getOperatorActivePubkeysFromContract } from './get-operator-active-pubkeys.js';

const firstPubkey = `0x${'11'.repeat(48)}`;
const secondPubkey = `0x${'22'.repeat(48)}`;

describe('getOperatorActivePubkeysFromContract', () => {
  it('returns deposited non-exited pubkeys from newest to oldest', async () => {
    const contract = {
      read: {
        getNodeOperator: vi.fn().mockResolvedValue([0n, 0n, 3n, 0n, 0n, 0n, 0n, 0n, 1n]),
        getSigningKeys: vi
          .fn()
          .mockResolvedValue(`0x${firstPubkey.slice(2)}${secondPubkey.slice(2)}`),
      },
    };

    const pubkeys = await getOperatorActivePubkeysFromContract(contract, 12);

    expect(contract.read.getNodeOperator).toHaveBeenCalledWith([12n]);
    expect(contract.read.getSigningKeys).toHaveBeenCalledWith([12n, 1n, 2n]);
    expect(pubkeys).toEqual([secondPubkey, firstPubkey]);
  });

  it('reads active counters from viem object-style tuple decoding', async () => {
    const contract = {
      read: {
        getNodeOperator: vi.fn().mockResolvedValue({
          totalDepositedKeys: 3,
          totalExitedKeys: 1,
        }),
        getSigningKeys: vi
          .fn()
          .mockResolvedValue(`0x${firstPubkey.slice(2)}${secondPubkey.slice(2)}`),
      },
    };

    const pubkeys = await getOperatorActivePubkeysFromContract(contract, 12);

    expect(contract.read.getSigningKeys).toHaveBeenCalledWith([12n, 1n, 2n]);
    expect(pubkeys).toEqual([secondPubkey, firstPubkey]);
  });

  it('returns no pubkeys when deposited keys are fully exited', async () => {
    const contract = {
      read: {
        getNodeOperator: vi.fn().mockResolvedValue([0n, 0n, 2n, 0n, 0n, 0n, 0n, 0n, 2n]),
        getSigningKeys: vi.fn(),
      },
    };

    const pubkeys = await getOperatorActivePubkeysFromContract(contract, 12);

    expect(contract.read.getSigningKeys).not.toHaveBeenCalled();
    expect(pubkeys).toEqual([]);
  });
});
