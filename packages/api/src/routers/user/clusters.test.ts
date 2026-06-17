import { describe, expect, it, vi } from 'vitest';

import { createUserRouter } from './index.js';

/**
 * Builds the minimum oRPC procedure chain needed to unit-test user route handlers.
 */
function createProcedureHarness() {
  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {};
  const procedure = {
    route({ path }: { path: string }) {
      return {
        input() {
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

  return { handlers, procedure };
}

describe('createUserRouter clusters route', () => {
  it('registers an API-key route that lists one user clusters with nested validators', async () => {
    // This scenario verifies token-authenticated callers can inspect clusters for any provided user id.
    const { handlers, procedure } = createProcedureHarness();
    const listWithValidatorsByOwner = vi.fn().mockResolvedValue([
      {
        id: 'cluster-a',
        name: 'Mainnet validators',
        visibility: 'private',
        feeRecipientAddress: '0x0000000000000000000000000000000000000001',
        lidoOperatorId: null,
        ownerId: 'user-a',
        createdAt: new Date('2026-01-10T12:00:00.000Z'),
        validators: [
          {
            validatorIndex: 42,
            validator: {
              withdrawalAddress: '0x0000000000000000000000000000000000000002',
              status: 1,
              balance: 32_500_000_000n,
              effectiveBalance: 32_000_000_000n,
              pubkey: '0xvalidator',
            },
          },
        ],
      },
    ]);

    // Registers the user router with both secured and API-key procedures because other user routes share it.
    createUserRouter({
      chain: 'ethereum',
      claimWithdrawalsService: null,
      clusterStorage: { listWithValidatorsByOwner },
      procedures: { apiKeyProcedure: procedure, securedProcedure: procedure },
      userStorage: {
        findClaimUserById: vi.fn(),
        getOrCreateAnonymous: vi.fn(),
        listOwnedClusterWithdrawalAddresses: vi.fn(),
        clearClaimableWithdrawalAddresses: vi.fn(),
        finalizeSuccessfulClaim: vi.fn(),
        updateLastClaimed: vi.fn(),
      },
    } as never);

    // Confirms the REST/RPC router exposes the approved user-scoped API-key endpoint.
    expect(handlers['/users/{userId}/clusters']).toBeDefined();

    // Calls the registered handler with the user id that should constrain the cluster query.
    const response = await handlers['/users/{userId}/clusters']({
      input: { userId: 'user-a' },
    });

    // Confirms only the requested owner id is passed to storage and balances are API-formatted.
    expect(listWithValidatorsByOwner).toHaveBeenCalledWith('user-a');
    expect(response).toEqual({
      success: true,
      data: [
        {
          id: 'cluster-a',
          name: 'Mainnet validators',
          visibility: 'private',
          feeRecipientAddress: '0x0000000000000000000000000000000000000001',
          lidoOperatorId: null,
          ownerId: 'user-a',
          createdAt: '2026-01-10T12:00:00.000Z',
          validators: [
            {
              validatorIndex: 42,
              withdrawalAddress: '0x0000000000000000000000000000000000000002',
              status: 1,
              balance: '32.5',
              effectiveBalance: '32',
              pubkey: '0xvalidator',
            },
          ],
        },
      ],
      meta: { timestamp: expect.any(String) },
    });
  });
});
