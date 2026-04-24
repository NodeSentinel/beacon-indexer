import {
  AnalyticsAllClustersInputSchema,
  AnalyticsClusterInputSchema,
  AnalyticsValidatorInputSchema,
  RewardsResponseSchema,
} from './analytics-schemas.js';
import { requireOwnedCluster } from './ownership.js';

import { securedProcedure } from '@/lib/procedures.js';
import { AnalyticsStorage } from '@/storage/analytics.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';
import { getTokenPrice } from '@/utils/tokenPrice.js';

const clusterStorage = new ClusterStorage();
const analyticsStorage = new AnalyticsStorage();

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
 * Fetch rewards for a set of validators within a time range.
 * All CL rewards are returned in token units (GNO or ETH) via formatBalance.
 * Execution rewards are returned in native EL token (xDAI or ETH) via formatWeiToToken.
 */
async function fetchRewards(
  validatorIndexes: number[],
  range: '1h' | '24h',
): Promise<RewardItem[]> {
  if (range === '1h') {
    const currentEpoch = beaconTime.getEpochNumberFromTimestamp(Date.now());
    const { slotsPerEpoch } = chainConfig.beacon;
    const epochsPerHour = Math.ceil(
      (60 * 60 * 1000) / (slotsPerEpoch * chainConfig.beacon.slotDuration),
    );
    const fromEpoch = currentEpoch - epochsPerHour;
    const fromSlot = fromEpoch * slotsPerEpoch;

    const [epochRows, syncRows, blockRows] = await Promise.all([
      analyticsStorage.getRewardsFromEpochRewards(validatorIndexes, fromEpoch),
      analyticsStorage.getSyncRewardsFromSlots(validatorIndexes, fromSlot, slotsPerEpoch),
      analyticsStorage.getBlockRewardsFromSlots(validatorIndexes, fromSlot, slotsPerEpoch),
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

    const epochByEpoch = new Map(epochRows.map((r) => [r.epoch, r]));

    const allEpochs = new Set([
      ...epochRows.map((r) => r.epoch),
      ...syncRows.map((r) => r.epoch),
      ...blockRows.map((r) => r.epoch),
    ]);

    return Array.from(allEpochs)
      .sort((a, b) => a - b)
      .map((epoch) => {
        const er = epochByEpoch.get(epoch);
        const syncReward = syncByEpoch.get(epoch) ?? BigInt(0);
        const syncMissed = syncMissedByEpoch.get(epoch) ?? BigInt(0);
        const block = blockByEpoch.get(epoch);
        const timestamp = new Date(beaconTime.getTimestampFromEpochNumber(epoch)).toISOString();

        return {
          timestamp,
          head: formatBalance(er?.head),
          target: formatBalance(er?.target),
          source: formatBalance(er?.source),
          inactivity: formatBalance(er?.inactivity),
          sync: formatBalance(syncReward),
          missed: formatBalance((er?.missed ?? BigInt(0)) + syncMissed),
          clMissed: formatBalance(er?.missed),
          syncMissed: formatBalance(syncMissed),
          blockConsensus: formatBalance(block?.consensus),
          // execution_reward is in wei of native EL token (xDAI/ETH)
          blockExecution: formatWeiToToken(block?.execution ?? BigInt(0)),
        };
      });
  }

  // 24h range — use archive aggregate columns
  const fromTimestamp = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
  const rows = await analyticsStorage.getRewardsFromArchive(validatorIndexes, fromTimestamp);

  return rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    // Archive has aggregate CL reward (head+target+source+inactivity combined)
    head: '0',
    target: '0',
    source: formatBalance(row.cl_reward),
    inactivity: '0',
    sync: formatBalance(row.sync_reward),
    missed: formatBalance(row.cl_missed + row.sync_missed),
    clMissed: formatBalance(row.cl_missed),
    syncMissed: formatBalance(row.sync_missed),
    blockConsensus: formatBalance(row.block_reward),
    blockExecution: formatWeiToToken(row.exec_reward ?? BigInt(0)),
  }));
}

/**
 * GET /clusters/{id}/analytics/rewards?range=1h|24h
 */
export const getClusterRewards = securedProcedure
  .route({ method: 'GET', path: '/clusters/{id}/analytics/rewards' })
  .input(AnalyticsClusterInputSchema)
  .output(ApiResponseSchema(RewardsResponseSchema))
  .handler(async ({ context, input }) => {
    const ownershipError = await requireOwnedCluster(clusterStorage, input.id, context.user);
    if (ownershipError) {
      return ownershipError;
    }

    const cluster = await clusterStorage.findByIdWithValidators(input.id);
    const validatorIndexes = cluster ? cluster.validators.map((v) => v.validatorIndex) : [];
    const items = await fetchRewards(validatorIndexes, input.range);
    let tokenPrice = 0;
    try {
      tokenPrice = await getTokenPrice();
    } catch {
      // tokenPrice stays 0 if fetch fails
    }
    return {
      success: true,
      data: { items, tokenPrice },
      meta: { timestamp: new Date().toISOString() },
    };
  });

/**
 * GET /clusters/all/analytics/rewards?ownerId=X&range=1h|24h
 */
export const getAllClustersRewards = securedProcedure
  .route({ method: 'GET', path: '/clusters/all/analytics/rewards' })
  .input(AnalyticsAllClustersInputSchema)
  .output(ApiResponseSchema(RewardsResponseSchema))
  .handler(async ({ context, input }) => {
    // Require a resolved user so reward aggregation stays scoped to one owner.
    if (!context.user) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        meta: { timestamp: new Date().toISOString() },
      };
    }

    const validatorIndexes = await clusterStorage.findAllValidatorIndexesByOwner(context.user!.id);
    const items = await fetchRewards(validatorIndexes, input.range);
    let tokenPrice = 0;
    try {
      tokenPrice = await getTokenPrice();
    } catch {
      // tokenPrice stays 0 if fetch fails
    }
    return {
      success: true,
      data: { items, tokenPrice },
      meta: { timestamp: new Date().toISOString() },
    };
  });

/**
 * GET /validators/{index}/analytics/rewards?range=1h|24h
 */
export const getValidatorRewards = securedProcedure
  .route({ method: 'GET', path: '/validators/{index}/analytics/rewards' })
  .input(AnalyticsValidatorInputSchema)
  .output(ApiResponseSchema(RewardsResponseSchema))
  .handler(async ({ input }) => {
    const items = await fetchRewards([input.index], input.range);
    let tokenPrice = 0;
    try {
      tokenPrice = await getTokenPrice();
    } catch {
      // tokenPrice stays 0 if fetch fails
    }
    return {
      success: true,
      data: { items, tokenPrice },
      meta: { timestamp: new Date().toISOString() },
    };
  });
