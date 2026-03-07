import { BlockProposalsInputSchema, BlockProposalsOutputSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { beaconTime } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

/**
 * Get paginated block proposals for a cluster or validator
 * GET /blocks
 */
export const getBlockProposals = publicProcedure
  .route({ method: 'GET', path: '/blocks' })
  .input(BlockProposalsInputSchema)
  .output(ApiResponseSchema(BlockProposalsOutputSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const { rows, totalCount } = await storage.getBlockProposals({
        clusterId: input.clusterId,
        validatorIndex: input.validatorIndex,
        page: input.page,
        pageSize: PAGE_SIZE,
      });

      const blocks = rows.map((row) => ({
        slot: row.slot,
        blockNumber: row.block_number,
        validatorIndex: row.proposer_index,
        timestamp: beaconTime.getTimestampFromSlotNumber(row.slot),
        consensusReward: row.consensus_reward !== null ? formatBalance(row.consensus_reward) : null,
        executionReward:
          row.execution_reward !== null ? formatWeiToToken(row.execution_reward) : null,
      }));

      return {
        success: true,
        data: {
          blocks,
          totalCount,
          page: input.page,
          pageSize: PAGE_SIZE,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch block proposals';
      return {
        success: false,
        error: { code: 'BLOCK_PROPOSALS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
