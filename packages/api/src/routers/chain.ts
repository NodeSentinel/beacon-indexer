/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import type { ApiProcedures } from '@/auth/middleware.js';
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
  tokenPrice: z.number(),
});

const ChainStatsResponseSchema = ApiResponseSchema(ChainStatsDataSchema);

const SyncStatusDataSchema = z.object({
  currentSlot: z.number().int(),
  processingSlot: z.number().int(),
  slotDurationMs: z.number().int(),
});

const SyncStatusResponseSchema = ApiResponseSchema(SyncStatusDataSchema);

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
          epoch: latestStats.epoch,
          totalActiveValidators: latestStats.totalActiveValidators,
          totalStaked: formatBalance(latestStats.totalStaked, params.chain),
          validatorsEntering: latestStats.validatorsEntering,
          enteringStaked: formatBalance(latestStats.enteringStaked, params.chain),
          validatorsExiting: latestStats.validatorsExiting,
          validatorsConsolidating: latestStats.validatorsConsolidating,
          tokenPrice,
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

      return {
        success: true,
        data: {
          currentSlot,
          processingSlot: lastProcessedSlot ? lastProcessedSlot.slot + 1 : 0,
          slotDurationMs: params.beaconHelpers.chainConfig.beacon.slotDuration,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  return {
    stats: getStats,
    syncStatus: getSyncStatus,
  };
}
