/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatDuration, intervalToDuration } from 'date-fns';
import { z } from 'zod';

import type { ApiProcedures } from '@/auth/middleware.js';
import type { ValidatorStorage } from '@/storage/validator.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';
import { getTokenPrice } from '@/utils/tokenPrice.js';

const ChainStatsDataSchema = z.object({
  epoch: z.number(),
  totalActiveValidators: z.number(),
  totalStaked: z.string(),
  validatorsEntering: z.number(),
  enteringStaked: z.string(),
  validatorsExiting: z.number(),
  validatorsConsolidating: z.number(),
});

const ChainStatsResponseSchema = ApiResponseSchema(ChainStatsDataSchema);

const TokenPriceDataSchema = z.object({
  tokenPrice: z.number(),
});

const TokenPriceResponseSchema = ApiResponseSchema(TokenPriceDataSchema);

const SyncStatusDataSchema = z.object({
  currentSlot: z.number().int(),
  processingSlot: z.number().int(),
  slotDurationMs: z.number().int(),
  distanceToHead: z.object({
    slots: z.number().int(),
    milliseconds: z.number().int(),
    days: z.number().int(),
    hours: z.number().int(),
    minutes: z.number().int(),
    formatted: z.string(),
  }),
});

const SyncStatusResponseSchema = ApiResponseSchema(SyncStatusDataSchema);

const StakeDistributionGroupSchema = z.object({
  stakeGroup: z.string(),
  withdrawalAddressCount: z.number().int(),
  validatorCount: z.number().int(),
  totalEffective: z.string(),
  token: z.string(),
});

const StakeDistributionDataSchema = z.object({
  groups: z.array(StakeDistributionGroupSchema),
});

const StakeDistributionResponseSchema = ApiResponseSchema(StakeDistributionDataSchema);

/**
 * Returns the consensus token symbol for the configured chain.
 */
function getConsensusTokenSymbol(chain: 'ethereum' | 'gnosis'): 'ETH' | 'GNO' {
  return chain === 'gnosis' ? 'GNO' : 'ETH';
}

/**
 * Formats a slot distance as day, hour, and minute parts.
 */
function getDistanceToHead(params: {
  currentSlot: number;
  processingSlot: number;
  slotDurationMs: number;
}) {
  const slots = Math.max(params.currentSlot - params.processingSlot, 0);
  const milliseconds = slots * params.slotDurationMs;
  const duration = intervalToDuration({ start: 0, end: milliseconds });
  const days = duration.days ?? 0;
  const hours = duration.hours ?? 0;
  const minutes = duration.minutes ?? 0;

  const formatted = formatDuration(
    { days, hours, minutes },
    { format: ['days', 'hours', 'minutes'] },
  );

  return {
    slots,
    milliseconds,
    days,
    hours,
    minutes,
    formatted,
  };
}

/**
 * Creates the chain router.
 */
export function createChainRouter(params: {
  beaconHelpers: {
    beaconTime: { getSlotNumberFromTimestamp: (timestamp: number) => number };
    chainConfig: { beacon: { slotDuration: number } };
  };
  chain: 'ethereum' | 'gnosis';
  logger: import('@/lib/logger.js').Logger;
  prisma: {
    chainEpochStats: {
      findFirst: typeof import('@beacon-indexer/db').PrismaClient.prototype.chainEpochStats.findFirst;
    };
    slot: { findFirst: typeof import('@beacon-indexer/db').PrismaClient.prototype.slot.findFirst };
  };
  procedures: ApiProcedures;
  tokenPriceApiUrl: string;
  tokenPriceTokenName: string;
  validatorStorage: ValidatorStorage;
}) {
  const { securedProcedure } = params.procedures;

  const getStats = securedProcedure
    .route({ method: 'GET', path: '/chain/stats' })
    .output(ChainStatsResponseSchema)
    .handler(async () => {
      const latestStats = await params.prisma.chainEpochStats.findFirst({
        orderBy: { epoch: 'desc' },
      });

      if (!latestStats) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No chain statistics available yet',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        };
      }

      return {
        success: true,
        data: {
          epoch: latestStats.epoch,
          totalActiveValidators: latestStats.totalActiveValidators,
          totalStaked: formatBalance(latestStats.totalStaked, params.chain),
          validatorsEntering: latestStats.validatorsEntering,
          enteringStaked: formatBalance(latestStats.enteringStaked, params.chain),
          validatorsExiting: latestStats.validatorsExiting,
          validatorsConsolidating: latestStats.validatorsConsolidating,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  const getTokenPriceRoute = securedProcedure
    .route({ method: 'GET', path: '/chain/token-price' })
    .output(TokenPriceResponseSchema)
    .handler(async () => {
      let tokenPrice = 0;
      try {
        tokenPrice = await getTokenPrice(
          params.tokenPriceApiUrl,
          params.tokenPriceTokenName,
          params.logger,
        );
      } catch {
        // Keeps the endpoint available even when the price feed fails.
      }

      return {
        success: true,
        data: {
          tokenPrice,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  const getStakeDistribution = securedProcedure
    .route({ method: 'GET', path: '/chain/stake-distribution' })
    .output(StakeDistributionResponseSchema)
    .handler(async () => {
      const token = getConsensusTokenSymbol(params.chain);
      const rows = await params.validatorStorage.getStakeDistributionByWithdrawalAddress({
        gweiPerTokenMultiplier: params.chain === 'gnosis' ? 32 : 1,
        tokenSymbol: token,
      });

      return {
        success: true,
        data: {
          groups: rows.map((row) => ({
            stakeGroup: row.stake_group,
            withdrawalAddressCount: Number(row.withdrawal_address_count),
            validatorCount: Number(row.validator_count),
            totalEffective: formatBalance(row.total_effective_gwei, params.chain),
            token,
          })),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  const getSyncStatus = securedProcedure
    .route({ method: 'GET', path: '/chain/sync-status' })
    .output(SyncStatusResponseSchema)
    .handler(async () => {
      const currentSlot = params.beaconHelpers.beaconTime.getSlotNumberFromTimestamp(Date.now());

      const lastProcessedSlot = await params.prisma.slot.findFirst({
        where: { processed: true },
        orderBy: { slot: 'desc' },
        select: { slot: true },
      });

      const processingSlot = lastProcessedSlot ? lastProcessedSlot.slot + 1 : 0;

      return {
        success: true,
        data: {
          currentSlot,
          processingSlot,
          slotDurationMs: params.beaconHelpers.chainConfig.beacon.slotDuration,
          distanceToHead: getDistanceToHead({
            currentSlot,
            processingSlot,
            slotDurationMs: params.beaconHelpers.chainConfig.beacon.slotDuration,
          }),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  return {
    stats: getStats,
    stakeDistribution: getStakeDistribution,
    syncStatus: getSyncStatus,
    tokenPrice: getTokenPriceRoute,
  };
}
