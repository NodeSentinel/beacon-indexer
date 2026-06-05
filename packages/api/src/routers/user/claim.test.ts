import { describe, expect, it, vi } from 'vitest';

import { createUserClaimRoute, executeUserClaim } from './claim.js';

const NOW = new Date('2026-01-10T12:00:00.000Z');
const RECENT_CLAIM = new Date('2026-01-05T12:00:00.000Z');
const OLD_CLAIM = new Date('2025-12-01T12:00:00.000Z');

const ADDRESS_ONE = '0x0000000000000000000000000000000000000001';
const ADDRESS_TWO = '0x0000000000000000000000000000000000000002';
const TRANSACTION_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TRANSACTION_URL = `https://gnosis.example/tx/${TRANSACTION_HASH}`;

/**
 * Builds the minimum oRPC procedure chain needed to unit-test route registration.
 */
function createProcedureHarness() {
  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {};
  const securedProcedure = {
    route({ path }: { path: string }) {
      return {
        output() {
          return {
            handler(handler: (params: unknown) => Promise<unknown>) {
              handlers[path] = handler;
              return handler;
            },
          };
        },
      };
    },
  };

  return { handlers, securedProcedure };
}

describe('executeUserClaim', () => {
  it('rejects anonymous users before reading claim addresses', async () => {
    // This scenario protects claim execution from anonymous browser sessions.
    const userStorage = {
      findClaimUserById: vi.fn().mockResolvedValue({
        id: 'user-a',
        telegramId: null,
        lastClaimed: null,
      }),
      listOwnedClusterWithdrawalAddresses: vi.fn(),
      clearClaimableWithdrawalAddresses: vi.fn(),
      updateLastClaimed: vi.fn(),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn(),
    };

    // Attempts to claim with a persisted user that has no Telegram id.
    const response = await executeUserClaim({
      chain: 'gnosis',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms non-Telegram users cannot trigger address lookup or transactions.
    expect(response).toMatchObject({
      success: false,
      error: {
        code: 'CLAIM_TELEGRAM_REQUIRED',
      },
    });
    expect(userStorage.listOwnedClusterWithdrawalAddresses).not.toHaveBeenCalled();
    expect(userStorage.clearClaimableWithdrawalAddresses).not.toHaveBeenCalled();
    expect(claimWithdrawalsService.claimWithdrawals).not.toHaveBeenCalled();
    expect(userStorage.updateLastClaimed).not.toHaveBeenCalled();
  });

  it('rejects Ethereum deployments as not implemented', async () => {
    // This scenario documents that claim support is Gnosis-only.
    const userStorage = {
      findClaimUserById: vi.fn(),
      listOwnedClusterWithdrawalAddresses: vi.fn(),
      clearClaimableWithdrawalAddresses: vi.fn(),
      updateLastClaimed: vi.fn(),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn(),
    };

    // Attempts to claim on an Ethereum API deployment.
    const claimAttempt = executeUserClaim({
      chain: 'ethereum',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms the route throws before touching user state or sending a transaction.
    await expect(claimAttempt).rejects.toThrow('Claiming is not implemented for Ethereum');
    expect(userStorage.findClaimUserById).not.toHaveBeenCalled();
    expect(claimWithdrawalsService.claimWithdrawals).not.toHaveBeenCalled();
  });

  it('rejects users whose claim cooldown is still active', async () => {
    // This scenario preserves the old bot cooldown rule based on User.lastClaimed.
    const userStorage = {
      findClaimUserById: vi.fn().mockResolvedValue({
        id: 'user-a',
        telegramId: 123n,
        lastClaimed: RECENT_CLAIM,
      }),
      listOwnedClusterWithdrawalAddresses: vi.fn(),
      clearClaimableWithdrawalAddresses: vi.fn(),
      updateLastClaimed: vi.fn(),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn(),
    };

    // Attempts to claim five days after the previous successful claim.
    const response = await executeUserClaim({
      chain: 'gnosis',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms the user must wait until seven days have passed.
    expect(response).toMatchObject({
      success: false,
      error: {
        code: 'CLAIM_COOLDOWN_ACTIVE',
        details: {
          nextClaimAt: '2026-01-12T12:00:00.000Z',
        },
      },
    });
    expect(userStorage.listOwnedClusterWithdrawalAddresses).not.toHaveBeenCalled();
    expect(userStorage.clearClaimableWithdrawalAddresses).not.toHaveBeenCalled();
    expect(claimWithdrawalsService.claimWithdrawals).not.toHaveBeenCalled();
    expect(userStorage.updateLastClaimed).not.toHaveBeenCalled();
  });

  it('rejects Telegram users without owned cluster withdrawal addresses', async () => {
    // This scenario covers users with clusters that have no claimable withdrawal address.
    const userStorage = {
      findClaimUserById: vi.fn().mockResolvedValue({
        id: 'user-a',
        telegramId: 123n,
        lastClaimed: OLD_CLAIM,
      }),
      listOwnedClusterWithdrawalAddresses: vi.fn().mockResolvedValue([]),
      clearClaimableWithdrawalAddresses: vi.fn(),
      updateLastClaimed: vi.fn(),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn(),
    };

    // Attempts to claim after cooldown with no addresses to pass to the contract.
    const response = await executeUserClaim({
      chain: 'gnosis',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms an empty address list does not produce an empty on-chain call.
    expect(response).toMatchObject({
      success: false,
      error: {
        code: 'CLAIM_ADDRESSES_EMPTY',
      },
    });
    expect(claimWithdrawalsService.claimWithdrawals).not.toHaveBeenCalled();
    expect(userStorage.clearClaimableWithdrawalAddresses).not.toHaveBeenCalled();
    expect(userStorage.updateLastClaimed).not.toHaveBeenCalled();
  });

  it('claims all distinct owned cluster withdrawal addresses and updates cooldown after success', async () => {
    // This scenario verifies one transaction claims every unique withdrawal address across the user clusters.
    const userStorage = {
      findClaimUserById: vi.fn().mockResolvedValue({
        id: 'user-a',
        telegramId: 123n,
        lastClaimed: OLD_CLAIM,
      }),
      listOwnedClusterWithdrawalAddresses: vi
        .fn()
        .mockResolvedValue([ADDRESS_ONE, ADDRESS_ONE, ADDRESS_TWO]),
      clearClaimableWithdrawalAddresses: vi.fn().mockResolvedValue(undefined),
      updateLastClaimed: vi.fn().mockResolvedValue(undefined),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn().mockResolvedValue({
        transactionHash: TRANSACTION_HASH,
        transactionUrl: TRANSACTION_URL,
      }),
    };

    // Claims after cooldown with two unique withdrawal addresses.
    const response = await executeUserClaim({
      chain: 'gnosis',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms the contract receives one deduplicated address list.
    expect(claimWithdrawalsService.claimWithdrawals).toHaveBeenCalledWith([
      ADDRESS_ONE,
      ADDRESS_TWO,
    ]);
    // Confirms the claimable snapshot cache is cleared for the same deduplicated addresses.
    expect(userStorage.clearClaimableWithdrawalAddresses).toHaveBeenCalledWith([
      ADDRESS_ONE,
      ADDRESS_TWO,
    ]);
    // Confirms cooldown is updated only after the transaction service succeeds and cache is cleared.
    expect(userStorage.updateLastClaimed).toHaveBeenCalledWith('user-a', NOW);
    expect(userStorage.clearClaimableWithdrawalAddresses.mock.invocationCallOrder[0]).toBeLessThan(
      userStorage.updateLastClaimed.mock.invocationCallOrder[0],
    );
    expect(response).toEqual({
      success: true,
      data: {
        claimedAddresses: [ADDRESS_ONE, ADDRESS_TWO],
        nextClaimAt: '2026-01-17T12:00:00.000Z',
        transactionHash: TRANSACTION_HASH,
        transactionUrl: TRANSACTION_URL,
      },
      meta: { timestamp: expect.any(String) },
    });
  });

  it('does not update cooldown when the on-chain claim fails', async () => {
    // This scenario preserves old bot behavior where failed transactions do not consume cooldown.
    const userStorage = {
      findClaimUserById: vi.fn().mockResolvedValue({
        id: 'user-a',
        telegramId: 123n,
        lastClaimed: OLD_CLAIM,
      }),
      listOwnedClusterWithdrawalAddresses: vi.fn().mockResolvedValue([ADDRESS_ONE]),
      clearClaimableWithdrawalAddresses: vi.fn(),
      updateLastClaimed: vi.fn(),
    };
    const claimWithdrawalsService = {
      claimWithdrawals: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    };

    // Attempts a claim whose transaction submission fails.
    const response = await executeUserClaim({
      chain: 'gnosis',
      claimWithdrawalsService,
      now: NOW,
      userId: 'user-a',
      userStorage,
    });

    // Confirms failed on-chain work is reported and does not change the cooldown timestamp.
    expect(response).toMatchObject({
      success: false,
      error: {
        code: 'CLAIM_TX_ERROR',
        message: 'RPC timeout',
      },
    });
    expect(userStorage.clearClaimableWithdrawalAddresses).not.toHaveBeenCalled();
    expect(userStorage.updateLastClaimed).not.toHaveBeenCalled();
  });
});

describe('createUserClaimRoute', () => {
  it('registers the user claim route under the current user resource', () => {
    // This scenario verifies REST and RPC expose claim as a user-owned action.
    const { handlers, securedProcedure } = createProcedureHarness();

    // Creates the route with the minimum dependencies needed for registration.
    const createdRoute = createUserClaimRoute({
      chain: 'gnosis',
      claimWithdrawalsService: { claimWithdrawals: vi.fn() },
      procedures: { securedProcedure } as never,
      userStorage: {
        findClaimUserById: vi.fn(),
        listOwnedClusterWithdrawalAddresses: vi.fn(),
        clearClaimableWithdrawalAddresses: vi.fn(),
        updateLastClaimed: vi.fn(),
      },
    });

    // Confirms the route is registered at POST /users/me/claim and returned to the router.
    expect(createdRoute).toBe(handlers['/users/me/claim']);
    expect(handlers['/users/me/claim']).toBeDefined();
  });
});
