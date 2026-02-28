import { z } from 'zod';

import { publicProcedure } from '@/lib/orpc.js';
import { getPrisma } from '@/lib/prisma.js';
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

interface ChainEpochStatsRow {
  epoch: number;
  total_active_validators: number;
  total_staked: bigint;
  validators_entering: number;
  validators_exiting: number;
  validators_consolidating: number;
}

const getStats = publicProcedure
  .route({ method: 'GET', path: '/chain/stats' })
  .output(ChainStatsResponseSchema)
  .handler(async () => {
    const prisma = getPrisma();

    const result = await prisma.$queryRaw<ChainEpochStatsRow[]>`
      SELECT
        epoch,
        total_active_validators,
        total_staked,
        validators_entering,
        validators_exiting,
        validators_consolidating
      FROM chain_epoch_stats
      ORDER BY epoch DESC
      LIMIT 1
    `;

    const row = result[0];

    if (!row) {
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
        epoch: row.epoch,
        totalActiveValidators: row.total_active_validators,
        totalStaked: formatBalance(row.total_staked),
        validatorsEntering: row.validators_entering,
        validatorsExiting: row.validators_exiting,
        validatorsConsolidating: row.validators_consolidating,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  });

export const chainRouter = {
  stats: getStats,
};
