import { ClusterIdParamSchema, ClusterSnapshotSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';

/**
 * Get cluster snapshot with aggregated performance metrics
 * GET /clusters/:id/snapshot
 */
export const getClusterSnapshot = publicProcedure
  .route({ method: 'GET', path: '/clusters/{id}/snapshot' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(ClusterSnapshotSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const row = await storage.getClusterSnapshot(input.id);

      if (!row) {
        return {
          success: false,
          error: {
            code: 'SNAPSHOT_NOT_FOUND',
            message: `No snapshot data for cluster ${input.id}`,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      const toNum = (v: string | null) => (v !== null ? Number(v) : null);
      const toBigStr = (v: bigint | null) => (v !== null ? formatBalance(v) : null);
      const toExecReward = (v: string | null) =>
        v !== null ? { wei: v, token: formatWeiToToken(v) } : null;

      return {
        success: true,
        data: {
          activeCount: Number(row.active_count),
          inactiveCount: Number(row.inactive_count),
          statusBreakdown: JSON.parse(row.beacon_status_breakdown),

          totalBalance: formatBalance(row.total_balance ?? BigInt(0)),
          totalEffectiveBalance: formatBalance(row.total_effective_balance ?? BigInt(0)),

          attestationsTotal: Number(row.attestations_total ?? 0),
          attestationsMissed: Number(row.attestations_missed ?? 0),

          performance1h: toNum(row.performance_1h),
          performance1d: toNum(row.performance_1d),
          performance1w: toNum(row.performance_1w),
          performance1m: toNum(row.performance_1m),

          apy1h: toNum(row.apy_1h),
          apy1d: toNum(row.apy_1d),
          apy1w: toNum(row.apy_w),
          apy1m: toNum(row.apy_1m),

          consensusReward1h: toBigStr(row.consensus_reward_1h),
          consensusReward1d: toBigStr(row.consensus_reward_1d),
          consensusReward1w: toBigStr(row.consensus_reward_1w),
          consensusReward1m: toBigStr(row.consensus_reward_1m),

          missedReward1h: toBigStr(row.missed_reward_1h),
          missedReward1d: toBigStr(row.missed_reward_1d),
          missedReward1w: toBigStr(row.missed_reward_1w),
          missedReward1m: toBigStr(row.missed_reward_1m),

          executionReward1h: toExecReward(row.execution_reward_1h),
          executionReward1d: toExecReward(row.execution_reward_1d),
          executionReward1w: toExecReward(row.execution_reward_1w),
          executionReward1m: toExecReward(row.execution_reward_1m),
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get cluster snapshot';
      return {
        success: false,
        error: { code: 'SNAPSHOT_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
