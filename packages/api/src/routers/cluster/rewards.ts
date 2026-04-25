/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AnalyticsAllClustersInputSchema,
  AnalyticsClusterInputSchema,
  AnalyticsValidatorInputSchema,
  RewardsResponseSchema,
} from './analytics-schemas.js';
import { requireOwnedCluster } from './ownership.js';

import type { ApiDependencies } from '@/dependencies.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';
import { getTokenPrice } from '@/utils/tokenPrice.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type RewardItem = {
  timestamp: string;
  head: string;
  target: string;
  source: string;
  inactivity: string;
  sync: string;
  missed: string;
  clMissed: string;
  syncMissed: string;
  blockConsensus: string;
  blockExecution: string;
};

/**
 * Loads reward rows for the requested range.
 */
async function fetchRewards(
  deps: Pick<
    ApiDependencies,
    'analyticsStorage' | 'beaconHelpers' | 'clusterStorage' | 'chain' | 'nativeTokenDecimals'
  >,
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<RewardItem[]> {
  if (range === '1h') {
    const currentEpoch = deps.beaconHelpers.beaconTime.getEpochNumberFromTimestamp(Date.now());
    const { slotDuration, slotsPerEpoch } = deps.beaconHelpers.chainConfig.beacon;
    const epochsPerHour = Math.ceil((60 * 60 * 1000) / (slotsPerEpoch * slotDuration));
    const fromEpoch = currentEpoch - epochsPerHour;
    const fromSlot = fromEpoch * slotsPerEpoch;

    const [epochRows, syncRows, blockRows] = await Promise.all([
      deps.analyticsStorage.getRewardsFromEpochRewards(validatorIndexes, fromEpoch),
      deps.analyticsStorage.getSyncRewardsFromSlots(validatorIndexes, fromSlot, slotsPerEpoch),
      deps.analyticsStorage.getBlockRewardsFromSlots(validatorIndexes, fromSlot, slotsPerEpoch),
    ]);

    const syncByEpoch = new Map<number, bigint>();
    const syncMissedByEpoch = new Map<number, bigint>();
    for (const row of syncRows) {
      syncByEpoch.set(row.epoch, row.sync_reward);
      syncMissedByEpoch.set(row.epoch, row.sync_missed);
    }

    const blockByEpoch = new Map<number, { consensus: bigint; execution: bigint }>();
    for (const row of blockRows) {
      blockByEpoch.set(row.epoch, {
        consensus: row.block_consensus,
        execution: row.block_execution,
      });
    }

    const epochByEpoch = new Map(epochRows.map((row) => [row.epoch, row]));
    const allEpochs = new Set([
      ...epochRows.map((row) => row.epoch),
      ...syncRows.map((row) => row.epoch),
      ...blockRows.map((row) => row.epoch),
    ]);

    return Array.from(allEpochs)
      .sort((left, right) => left - right)
      .map((epoch) => {
        const epochReward = epochByEpoch.get(epoch);
        const syncReward = syncByEpoch.get(epoch) ?? BigInt(0);
        const syncMissed = syncMissedByEpoch.get(epoch) ?? BigInt(0);
        const block = blockByEpoch.get(epoch);

        return {
          timestamp: new Date(
            deps.beaconHelpers.beaconTime.getTimestampFromEpochNumber(epoch),
          ).toISOString(),
          head: formatBalance(epochReward?.head, deps.chain),
          target: formatBalance(epochReward?.target, deps.chain),
          source: formatBalance(epochReward?.source, deps.chain),
          inactivity: formatBalance(epochReward?.inactivity, deps.chain),
          sync: formatBalance(syncReward, deps.chain),
          missed: formatBalance((epochReward?.missed ?? BigInt(0)) + syncMissed, deps.chain),
          clMissed: formatBalance(epochReward?.missed, deps.chain),
          syncMissed: formatBalance(syncMissed, deps.chain),
          blockConsensus: formatBalance(block?.consensus, deps.chain),
          blockExecution: formatWeiToToken(block?.execution ?? BigInt(0), deps.nativeTokenDecimals),
        };
      });
  }

  const rows = await deps.analyticsStorage.getRewardsFromArchive(
    validatorIndexes,
    new Date(Date.now() - TWENTY_FOUR_HOURS_MS),
  );

  return rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    head: '0',
    target: '0',
    source: formatBalance(row.cl_reward, deps.chain),
    inactivity: '0',
    sync: formatBalance(row.sync_reward, deps.chain),
    missed: formatBalance(row.cl_missed + row.sync_missed, deps.chain),
    clMissed: formatBalance(row.cl_missed, deps.chain),
    syncMissed: formatBalance(row.sync_missed, deps.chain),
    blockConsensus: formatBalance(row.block_reward, deps.chain),
    blockExecution: formatWeiToToken(row.exec_reward ?? BigInt(0), deps.nativeTokenDecimals),
  }));
}

/**
 * Creates the cluster rewards route.
 */
export function createClusterRewardsRoute(
  deps: Pick<
    ApiDependencies,
    | 'analyticsStorage'
    | 'beaconHelpers'
    | 'clusterStorage'
    | 'procedures'
    | 'chain'
    | 'logger'
    | 'nativeTokenDecimals'
    | 'tokenPriceApiUrl'
    | 'tokenPriceTokenName'
  >,
) {
  const { securedProcedure } = deps.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/{id}/analytics/rewards' })
    .input(AnalyticsClusterInputSchema)
    .output(ApiResponseSchema(RewardsResponseSchema))
    .handler(async ({ context, input }: any) => {
      const ownershipError = await requireOwnedCluster(deps.clusterStorage, input.id, context.user);
      if (ownershipError) {
        return ownershipError;
      }

      const cluster = await deps.clusterStorage.findByIdWithValidators(input.id);
      const validatorIndexes = cluster
        ? cluster.validators.map((validator) => validator.validatorIndex)
        : [];

      let tokenPrice = 0;
      try {
        tokenPrice = await getTokenPrice(
          deps.tokenPriceApiUrl,
          deps.tokenPriceTokenName,
          deps.logger,
        );
      } catch {
        // Leaves price at zero when the remote source fails.
      }

      return {
        success: true,
        data: {
          items: await fetchRewards(deps, validatorIndexes, input.range),
          tokenPrice,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
}

/**
 * Creates the all-clusters rewards route.
 */
export function createAllClustersRewardsRoute(
  deps: Pick<
    ApiDependencies,
    | 'analyticsStorage'
    | 'beaconHelpers'
    | 'clusterStorage'
    | 'procedures'
    | 'chain'
    | 'logger'
    | 'nativeTokenDecimals'
    | 'tokenPriceApiUrl'
    | 'tokenPriceTokenName'
  >,
) {
  const { securedProcedure } = deps.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/all/analytics/rewards' })
    .input(AnalyticsAllClustersInputSchema)
    .output(ApiResponseSchema(RewardsResponseSchema))
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      let tokenPrice = 0;
      try {
        tokenPrice = await getTokenPrice(
          deps.tokenPriceApiUrl,
          deps.tokenPriceTokenName,
          deps.logger,
        );
      } catch {
        // Leaves price at zero when the remote source fails.
      }

      return {
        success: true,
        data: {
          items: await fetchRewards(
            deps,
            await deps.clusterStorage.findAllValidatorIndexesByOwner(context.user.id),
            input.range,
          ),
          tokenPrice,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
}

/**
 * Creates the validator rewards route.
 */
export function createValidatorRewardsRoute(
  deps: Pick<
    ApiDependencies,
    | 'analyticsStorage'
    | 'beaconHelpers'
    | 'clusterStorage'
    | 'procedures'
    | 'chain'
    | 'logger'
    | 'nativeTokenDecimals'
    | 'tokenPriceApiUrl'
    | 'tokenPriceTokenName'
  >,
) {
  const { securedProcedure } = deps.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/validators/{index}/analytics/rewards' })
    .input(AnalyticsValidatorInputSchema)
    .output(ApiResponseSchema(RewardsResponseSchema))
    .handler(async ({ input }: any) => {
      let tokenPrice = 0;
      try {
        tokenPrice = await getTokenPrice(
          deps.tokenPriceApiUrl,
          deps.tokenPriceTokenName,
          deps.logger,
        );
      } catch {
        // Leaves price at zero when the remote source fails.
      }

      return {
        success: true,
        data: {
          items: await fetchRewards(deps, [input.index], input.range),
          tokenPrice,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
}
