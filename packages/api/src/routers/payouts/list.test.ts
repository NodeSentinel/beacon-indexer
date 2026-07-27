import { describe, expect, it, vi } from 'vitest';

import { createListPayoutsRoute } from './list.js';

/**
 * Builds the minimum secured procedure chain needed to invoke the payouts handler.
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
      if (!routeHandler) throw new Error('Payout route handler was not registered');
      return routeHandler;
    },
    securedProcedure,
  };
}

// This suite verifies completed payouts cannot be listed through another user's cluster identifier.
describe('createListPayoutsRoute', () => {
  // This scenario expects ownership rejection before any completed payout rows are queried.
  it('rejects a cluster that is not owned by the authenticated user', async () => {
    // The ownership lookup returns false for the concrete user and cluster pair under test.
    const existsForOwner = vi.fn().mockResolvedValue(false);
    const getPayouts = vi.fn();
    const { getHandler, securedProcedure } = createProcedureHarness();

    // The route receives storage mocks that reveal whether authorization occurs before payout access.
    createListPayoutsRoute({
      beaconHelpers: {} as never,
      chain: 'ethereum',
      clusterStorage: { existsForOwner } as never,
      payoutStorage: { getPayouts } as never,
      procedures: { securedProcedure } as never,
    });

    // An authenticated user requests a cluster that the ownership storage does not associate with them.
    const result = (await getHandler()({
      context: { user: { id: 'user-a', username: 'requester' } },
      input: { clusterId: 'cluster-b', page: 1 },
    } as never)) as {
      success: boolean;
      error: { code: string };
    };

    // The route hides cluster existence and never queries completed payout data.
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'CLUSTER_NOT_FOUND' }),
      }),
    );
    expect(existsForOwner).toHaveBeenCalledWith('cluster-b', 'user-a');
    expect(getPayouts).not.toHaveBeenCalled();
  });
});
