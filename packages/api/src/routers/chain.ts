import { z } from 'zod';

import { publicProcedure } from '@/lib/orpc.js';
import { getPrisma } from '@/lib/prisma.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const ChainStatsDataSchema = z.object({
  epoch: z.number(),
  totalActiveValidators: z.number(),
  totalStaked: z.string(),
  validatorsEntering: z.number(),
  validatorsExiting: z.number(),
  validatorsConsolidating: z.number(),
});

const ChainStatsResponseSchema = ApiResponseSchema(ChainStatsDataSchema);

const getStats = publicProcedure
  .route({ method: 'GET', path: '/chain/stats' })
  .output(ChainStatsResponseSchema)
  .handler(async () => {
    const prisma = getPrisma();

    const latestStats = await prisma.chainEpochStats.findFirst({
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
        totalStaked: formatBalance(latestStats.totalStaked),
        validatorsEntering: latestStats.validatorsEntering,
        validatorsExiting: latestStats.validatorsExiting,
        validatorsConsolidating: latestStats.validatorsConsolidating,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  });

const SyncStatusDataSchema = z.object({
  currentSlot: z.number().int(),
  processingSlot: z.number().int(),
  slotDurationMs: z.number().int(),
});

const SyncStatusResponseSchema = ApiResponseSchema(SyncStatusDataSchema);

const getSyncStatus = publicProcedure
  .route({ method: 'GET', path: '/chain/sync-status' })
  .output(SyncStatusResponseSchema)
  .handler(async () => {
    const prisma = getPrisma();
    const currentSlot = beaconTime.getSlotNumberFromTimestamp(Date.now());

    const lastProcessedSlot = await prisma.slot.findFirst({
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
        slotDurationMs: chainConfig.beacon.slotDuration,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  });

export const chainRouter = {
  stats: getStats,
  syncStatus: getSyncStatus,
};
