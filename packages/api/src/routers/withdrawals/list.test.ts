import { describe, expect, it, vi } from 'vitest';

import { createListWithdrawalsRoute } from './list.js';

/**
 * Builds the minimum secured procedure chain needed to invoke the withdrawals handler.
 */
function createProcedureHarness() {
  let routeHandler: ((params: never) => Promise<unknown>) | undefined;
  const securedProcedure = {
    route() {
      return {
        input() {
          return {
            output() {
              return {
                handler(handler: (params: never) => Promise<unknown>) {
                  routeHandler = handler;
                  return handler;
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    getHandler: () => {
      if (!routeHandler) throw new Error('Withdrawal route handler was not registered');
      return routeHandler;
    },
    securedProcedure,
  };
}

// This suite verifies EIP-7002 requests remain distinct from completed payouts in the API contract.
describe('createListWithdrawalsRoute', () => {
  // This scenario expects amount zero to represent a full exit and a positive amount to represent a partial request.
  it('classifies full exits and partial withdrawal requests', async () => {
    // These rows model the two EIP-7002 meanings of the amount field for one owned cluster.
    const getWithdrawals = vi.fn().mockResolvedValue({
      hasNextPage: false,
      rows: [
        {
          slot: 100,
          request_index: 0,
          validator_index: 12,
          pubkey: '0xfull-exit-validator',
          source_address: '0xfull-exit-owner',
          amount: 0n,
        },
        {
          slot: 99,
          request_index: 1,
          validator_index: 13,
          pubkey: '0xpartial-validator',
          source_address: '0xpartial-owner',
          amount: 1_000_000_000n,
        },
      ],
    });
    const { getHandler, securedProcedure } = createProcedureHarness();

    // The route uses deterministic timestamps and confirms ownership before reading request rows.
    createListWithdrawalsRoute({
      beaconHelpers: {
        beaconTime: { getTimestampFromSlotNumber: (slot: number) => slot * 12_000 },
      } as never,
      chain: 'ethereum',
      clusterStorage: { existsForOwner: vi.fn().mockResolvedValue(true) } as never,
      procedures: { securedProcedure } as never,
      withdrawalStorage: { getWithdrawals } as never,
    });

    // An authenticated owner requests the first page for the concrete test cluster.
    const result = (await getHandler()({
      context: { user: { id: 'user-a', username: 'owner' } },
      input: { clusterId: 'cluster-a', page: 1 },
    } as never)) as {
      success: boolean;
      data: { withdrawals: Array<{ type: string; amount: string }> };
    };

    // The API exposes request intent without treating either row as a completed payout.
    expect(result.success).toBe(true);
    expect(result.data.withdrawals).toEqual([
      expect.objectContaining({ type: 'full_exit', amount: '0' }),
      expect.objectContaining({ type: 'partial', amount: '1' }),
    ]);
    expect(getWithdrawals).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      page: 1,
      pageSize: 10,
    });
  });
});
