/* eslint-disable @typescript-eslint/no-explicit-any */
import { BlockProposalsInputSchema, BlockProposalsOutputSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

/**
 * Creates the block proposals route.
 */
export function createListBlockProposalsRoute(params: {
  beaconHelpers: {
    beaconTime: { getTimestampFromSlotNumber: (slot: number) => number };
  };
  blockStorage: {
    getBlockProposals: (input: {
      clusterId?: string;
      page: number;
      pageSize: number;
      validatorIndex?: number;
    }) => Promise<{ rows: any[]; totalCount: number }>;
  };
  chain: 'ethereum' | 'gnosis';
  nativeTokenDecimals: number;
  procedures: { securedProcedure: any };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/blocks' })
    .input(BlockProposalsInputSchema)
    .output(ApiResponseSchema(BlockProposalsOutputSchema))
    .handler(async ({ input }: any) => {
      try {
        const { rows, totalCount } = await params.blockStorage.getBlockProposals({
          clusterId: input.clusterId,
          validatorIndex: input.validatorIndex,
          page: input.page,
          pageSize: PAGE_SIZE,
        });

        return {
          success: true,
          data: {
            blocks: rows.map((row) => ({
              slot: row.slot,
              blockNumber: row.block_number,
              validatorIndex: row.proposer_index,
              timestamp: params.beaconHelpers.beaconTime.getTimestampFromSlotNumber(row.slot),
              consensusReward:
                row.consensus_reward !== null
                  ? formatBalance(row.consensus_reward, params.chain)
                  : null,
              executionReward:
                row.execution_reward !== null
                  ? formatWeiToToken(row.execution_reward, params.nativeTokenDecimals)
                  : null,
            })),
            totalCount,
            page: input.page,
            pageSize: PAGE_SIZE,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'BLOCK_PROPOSALS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to fetch block proposals',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
