import { ClusterIdParamSchema, ClusterSnapshotSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';
import { getTokenPrice } from '@/utils/tokenPrice.js';

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

      let tokenPrice = 0;
      try {
        tokenPrice = await getTokenPrice();
      } catch {
        // tokenPrice stays 0 if fetch fails
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

          performanceH: toNum(row.performance_h),
          performanceD: toNum(row.performance_d),
          performanceW: toNum(row.performance_w),
          performanceM: toNum(row.performance_m),

          apyH: toNum(row.apy_h),
          apyD: toNum(row.apy_d),
          apyW: toNum(row.apy_w),
          apyM: toNum(row.apy_m),

          consensusRewardH: toBigStr(row.consensus_reward_h),
          consensusRewardD: toBigStr(row.consensus_reward_d),
          consensusRewardW: toBigStr(row.consensus_reward_w),
          consensusRewardM: toBigStr(row.consensus_reward_m),

          missedRewardH: toBigStr(row.missed_reward_h),
          missedRewardD: toBigStr(row.missed_reward_d),
          missedRewardW: toBigStr(row.missed_reward_w),
          missedRewardM: toBigStr(row.missed_reward_m),

          executionRewardH: toExecReward(row.execution_reward_h),
          executionRewardD: toExecReward(row.execution_reward_d),
          executionRewardW: toExecReward(row.execution_reward_w),
          executionRewardM: toExecReward(row.execution_reward_m),

          attestationEfficiencyD: toNum(row.attestation_efficiency_d),
          attestationEfficiencyW: toNum(row.attestation_efficiency_w),
          attestationEfficiencyM: toNum(row.attestation_efficiency_m),

          avgAttestationDelayD: toNum(row.avg_attestation_delay_d),
          avgAttestationDelayW: toNum(row.avg_attestation_delay_w),
          avgAttestationDelayM: toNum(row.avg_attestation_delay_m),

          tokenPrice,
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
