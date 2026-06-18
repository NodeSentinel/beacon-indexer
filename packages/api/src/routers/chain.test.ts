import { describe, expect, it, vi } from 'vitest';

import { createChainRouter } from './chain.js';

/**
 * Builds the minimum oRPC procedure chain needed to unit-test route handlers.
 */
function createProcedureHarness() {
  const handlers: Record<string, () => Promise<unknown>> = {};
  const securedProcedure = {
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

  return { handlers, securedProcedure };
}

/**
 * Creates the chain router with only the dependencies used by these tests.
 */
function createTestRouter(params: {
  chain?: 'ethereum' | 'gnosis';
  currentSlot?: number;
  getStakeDistributionByWithdrawalAddress?: ReturnType<typeof vi.fn>;
  slotFindFirst?: ReturnType<typeof vi.fn>;
}) {
  const { handlers, securedProcedure } = createProcedureHarness();

  createChainRouter({
    beaconHelpers: {
      beaconTime: { getSlotNumberFromTimestamp: () => params.currentSlot ?? 1 },
      chainConfig: { beacon: { slotDuration: 12_000 } },
    },
    chain: params.chain ?? 'ethereum',
    logger: {} as never,
    prisma: {
      chainEpochStats: { findFirst: vi.fn() },
      slot: { findFirst: params.slotFindFirst ?? vi.fn() },
    },
    procedures: { securedProcedure } as never,
    tokenPriceApiUrl: '',
    tokenPriceTokenName: '',
    validatorStorage: {
      getStakeDistributionByWithdrawalAddress:
        params.getStakeDistributionByWithdrawalAddress ?? vi.fn(),
    } as never,
  });

  return { handlers };
}

describe('createChainRouter stake distribution', () => {
  it('returns one row per configured stake group', async () => {
    // This scenario verifies the endpoint response is bucketed by unique withdrawal address stake.
    const getStakeDistributionByWithdrawalAddress = vi.fn().mockResolvedValue([
      {
        stake_group: '<640 ETH',
        withdrawal_address_count: 2,
        validator_count: 4,
        total_effective_gwei: '128000000000',
      },
      {
        stake_group: '640-3,200 ETH',
        withdrawal_address_count: 1,
        validator_count: 20,
        total_effective_gwei: '640000000000',
      },
      {
        stake_group: '3,200-9,600 ETH',
        withdrawal_address_count: 0,
        validator_count: 0,
        total_effective_gwei: '0',
      },
      {
        stake_group: '9,600-32,000 ETH',
        withdrawal_address_count: 0,
        validator_count: 0,
        total_effective_gwei: '0',
      },
      {
        stake_group: '>=32,000 ETH',
        withdrawal_address_count: 1,
        validator_count: 1_000,
        total_effective_gwei: '32000000000000',
      },
    ]);
    const { handlers } = createTestRouter({ getStakeDistributionByWithdrawalAddress });

    // Calls the registered route handler without starting an HTTP server.
    const response = await handlers['/chain/stake-distribution']();

    // Confirms the API returns only bucket-level distribution rows.
    expect(response).toEqual({
      success: true,
      data: {
        groups: [
          {
            stakeGroup: '<640 ETH',
            withdrawalAddressCount: 2,
            validatorCount: 4,
            totalEffective: '128',
            token: 'ETH',
          },
          {
            stakeGroup: '640-3,200 ETH',
            withdrawalAddressCount: 1,
            validatorCount: 20,
            totalEffective: '640',
            token: 'ETH',
          },
          {
            stakeGroup: '3,200-9,600 ETH',
            withdrawalAddressCount: 0,
            validatorCount: 0,
            totalEffective: '0',
            token: 'ETH',
          },
          {
            stakeGroup: '9,600-32,000 ETH',
            withdrawalAddressCount: 0,
            validatorCount: 0,
            totalEffective: '0',
            token: 'ETH',
          },
          {
            stakeGroup: '>=32,000 ETH',
            withdrawalAddressCount: 1,
            validatorCount: 1_000,
            totalEffective: '32000',
            token: 'ETH',
          },
        ],
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
    // Confirms the route delegates data access to the storage layer.
    expect(getStakeDistributionByWithdrawalAddress).toHaveBeenCalledWith({
      gweiPerTokenMultiplier: 1,
      tokenSymbol: 'ETH',
    });
  });

  it('formats stake groups and totals for Gnosis', async () => {
    // This scenario verifies Gnosis responses use GNO labels and the chain balance formatter.
    const getStakeDistributionByWithdrawalAddress = vi.fn().mockResolvedValue([
      {
        stake_group: '<640 GNO',
        withdrawal_address_count: 1,
        validator_count: 32,
        total_effective_gwei: '32000000000',
      },
    ]);
    const { handlers } = createTestRouter({
      chain: 'gnosis',
      getStakeDistributionByWithdrawalAddress,
    });

    // Calls the registered route handler with a Gnosis chain configuration.
    const response = await handlers['/chain/stake-distribution']();

    // Confirms gwei values are converted to GNO through the shared formatter.
    expect(response).toEqual({
      success: true,
      data: {
        groups: [
          {
            stakeGroup: '<640 GNO',
            withdrawalAddressCount: 1,
            validatorCount: 32,
            totalEffective: '1',
            token: 'GNO',
          },
        ],
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
    // Confirms Gnosis storage thresholds use the chain-specific multiplier.
    expect(getStakeDistributionByWithdrawalAddress).toHaveBeenCalledWith({
      gweiPerTokenMultiplier: 32,
      tokenSymbol: 'GNO',
    });
  });
});

describe('createChainRouter sync status', () => {
  it('returns the time distance from the processing slot to head', async () => {
    // This scenario verifies sync status reports human-readable lag from the next pending slot.
    const slotFindFirst = vi.fn().mockResolvedValue({ slot: 399 });
    const { handlers } = createTestRouter({
      currentSlot: 10_000,
      slotFindFirst,
    });

    // Calls the sync status handler without starting an HTTP server.
    const response = await handlers['/chain/sync-status']();

    // Confirms the endpoint reports lag in slots, milliseconds, and day/hour/minute parts.
    expect(response).toEqual({
      success: true,
      data: {
        currentSlot: 10_000,
        processingSlot: 400,
        slotDurationMs: 12_000,
        distanceToHead: {
          slots: 9_600,
          milliseconds: 115_200_000,
          days: 1,
          hours: 8,
          minutes: 0,
          formatted: '1 day 8 hours',
        },
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
  });
});
