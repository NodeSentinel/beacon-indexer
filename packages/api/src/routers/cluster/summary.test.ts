import { describe, expect, it, vi } from 'vitest';

import { createClusterSummaryRoute } from './summary.js';

/**
 * Builds the minimum API-key procedure chain needed to unit-test route handlers.
 */
function createProcedureHarness() {
  const handlers: Record<string, () => Promise<unknown>> = {};
  const apiKeyProcedure = {
    route({ path }: { path: string }) {
      return {
        output() {
          return {
            handler(handler: () => Promise<unknown>) {
              handlers[path] = handler;
              return handler;
            },
          };
        },
      };
    },
  };

  return { apiKeyProcedure, handlers };
}

/**
 * Creates the summary route with only the dependencies used by this test.
 */
function createTestRoute(params: {
  chain: 'ethereum' | 'gnosis';
  getSummary: ReturnType<typeof vi.fn>;
}) {
  const { apiKeyProcedure, handlers } = createProcedureHarness();

  createClusterSummaryRoute({
    chain: params.chain,
    clusterStorage: {
      getSummary: params.getSummary,
    },
    procedures: { apiKeyProcedure } as never,
  });

  return { handlers };
}

describe('createClusterSummaryRoute', () => {
  it('formats summary effective balances with the configured Ethereum chain', async () => {
    // This scenario verifies the API response exposes token amounts instead of raw gwei.
    const getSummary = vi.fn().mockResolvedValue({
      totalClusters: 2,
      totalUsers: 2,
      totalUniqueValidators: 4,
      totalEffectiveBalance: 127_500_000_000n,
      clusters: [
        {
          id: 'cluster-a',
          name: 'Main cluster',
          ownerId: 'user-a',
          ownerUsername: 'alice',
          validatorCount: 3,
          effectiveBalance: 63_500_000_000n,
        },
        {
          id: 'cluster-b',
          name: 'Backup cluster',
          ownerId: 'user-b',
          ownerUsername: 'annon',
          validatorCount: 2,
          effectiveBalance: 64_000_000_000n,
        },
      ],
    });
    const { handlers } = createTestRoute({ chain: 'ethereum', getSummary });

    // Calls the registered route handler without starting an HTTP server.
    const response = await handlers['/clusters/summary']();

    // Confirms Ethereum deployments expose gwei values as ETH token amounts.
    expect(response).toEqual({
      success: true,
      data: {
        totalClusters: 2,
        totalUsers: 2,
        totalUniqueValidators: 4,
        totalTokenAmount: '127.5',
        clusters: [
          {
            id: 'cluster-a',
            name: 'Main cluster',
            ownerId: 'user-a',
            ownerUsername: 'alice',
            validatorCount: 3,
            tokenAmount: '63.5',
          },
          {
            id: 'cluster-b',
            name: 'Backup cluster',
            ownerId: 'user-b',
            ownerUsername: 'annon',
            validatorCount: 2,
            tokenAmount: '64',
          },
        ],
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
  });

  it('formats summary effective balances with the configured Gnosis chain', async () => {
    // This scenario verifies Gnosis deployments use the same chain-aware balance formatter.
    const getSummary = vi.fn().mockResolvedValue({
      totalClusters: 1,
      totalUsers: 1,
      totalUniqueValidators: 32,
      totalEffectiveBalance: 32_000_000_000n,
      clusters: [
        {
          id: 'cluster-a',
          name: 'Gnosis cluster',
          ownerId: 'user-a',
          ownerUsername: 'alice',
          validatorCount: 32,
          effectiveBalance: 32_000_000_000n,
        },
      ],
    });
    const { handlers } = createTestRoute({ chain: 'gnosis', getSummary });

    // Calls the registered route handler with a Gnosis chain configuration.
    const response = await handlers['/clusters/summary']();

    // Confirms Gnosis deployments expose gwei values as GNO token amounts.
    expect(response).toEqual({
      success: true,
      data: {
        totalClusters: 1,
        totalUsers: 1,
        totalUniqueValidators: 32,
        totalTokenAmount: '1',
        clusters: [
          {
            id: 'cluster-a',
            name: 'Gnosis cluster',
            ownerId: 'user-a',
            ownerUsername: 'alice',
            validatorCount: 32,
            tokenAmount: '1',
          },
        ],
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
  });
});
