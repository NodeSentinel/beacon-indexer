import { describe, expect, it, vi } from 'vitest';

import { createClusterSnapshotRoute } from './snapshot.js';

vi.mock('@/utils/tokenPrice.js', () => ({
  getTokenPrice: vi.fn().mockResolvedValue(42),
}));

/**
 * Builds the minimum secured procedure chain needed to unit-test snapshot route handlers.
 */
function createProcedureHarness() {
  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {};
  const securedProcedure = {
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
      };
    },
  };

  return { handlers, securedProcedure };
}

/**
 * Creates a complete storage row with zero-like values for fields unrelated to claimable rewards.
 */
function createSnapshotRow() {
  return {
    active_count: 1n,
    inactive_count: 0n,
    beacon_status_breakdown: '{}',
    total_balance: 32_000_000_000n,
    total_effective_balance: 32_000_000_000n,
    performance_h: null,
    performance_d: null,
    performance_w: null,
    performance_m: null,
    apy_h: null,
    apy_d: null,
    apy_w: null,
    apy_m: null,
    consensus_reward_h: null,
    consensus_reward_d: null,
    consensus_reward_w: null,
    consensus_reward_m: null,
    missed_reward_h: null,
    missed_reward_d: null,
    missed_reward_w: null,
    missed_reward_m: null,
    execution_reward_h: null,
    execution_reward_d: null,
    execution_reward_w: null,
    execution_reward_m: null,
    attestation_efficiency_d: null,
    attestation_efficiency_w: null,
    attestation_efficiency_m: null,
    avg_attestation_delay_d: null,
    avg_attestation_delay_w: null,
    avg_attestation_delay_m: null,
    claimable_rewards: null,
  };
}

/**
 * Creates the snapshot route with only the dependencies used by these tests.
 */
function createTestRoute(params: {
  chain: 'ethereum' | 'gnosis';
  getClusterSnapshot: ReturnType<typeof vi.fn>;
}) {
  const { handlers, securedProcedure } = createProcedureHarness();

  createClusterSnapshotRoute({
    chain: params.chain,
    clusterStorage: {
      existsForOwner: vi.fn().mockResolvedValue(true),
      getClusterSnapshot: params.getClusterSnapshot,
    },
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    nativeTokenDecimals: 18,
    procedures: { securedProcedure } as never,
    tokenPriceApiUrl: 'https://price.example',
    tokenPriceTokenName: 'gno',
  });

  return handlers['/clusters/{id}/snapshot'];
}

describe('createClusterSnapshotRoute', () => {
  // These route tests verify the chain-specific claimable flag passed from API route to storage.
  it('disables claimable reward storage work on Ethereum deployments', async () => {
    // This scenario ensures Ethereum snapshots do not query the Gnosis-only claimable cache.
    const getClusterSnapshot = vi.fn().mockResolvedValue(createSnapshotRow());
    const handler = createTestRoute({ chain: 'ethereum', getClusterSnapshot });

    // Fetches a cluster snapshot for an authenticated owner on an Ethereum deployment.
    await handler({
      context: { user: { id: 'user-a' } },
      input: { id: 'cluster-a' },
    });

    // Confirms the route passes an explicit flag that lets storage omit claimable SQL.
    expect(getClusterSnapshot).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      includeClaimable: false,
    });
  });

  it('enables claimable reward storage work on Gnosis deployments', async () => {
    // This scenario ensures Gnosis snapshots opt into the claimable cache join.
    const getClusterSnapshot = vi.fn().mockResolvedValue(createSnapshotRow());
    const handler = createTestRoute({ chain: 'gnosis', getClusterSnapshot });

    // Fetches a cluster snapshot for an authenticated owner on a Gnosis deployment.
    await handler({
      context: { user: { id: 'user-a' } },
      input: { id: 'cluster-a' },
    });

    // Confirms the route asks storage to include claimable rewards only on Gnosis.
    expect(getClusterSnapshot).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      includeClaimable: true,
    });
  });
});
