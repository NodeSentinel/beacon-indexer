/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOwnedCluster } from './ownership.js';
import { ClusterIdParamSchema, ClusterSnapshotSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance, formatWeiToToken } from '@/utils/tokenFormat.js';
import { getTokenPrice } from '@/utils/tokenPrice.js';

/**
 * Creates the cluster snapshot route.
 */
export function createClusterSnapshotRoute(params: {
  chain: 'ethereum' | 'gnosis';
  clusterStorage: any;
  logger: import('@/lib/logger.js').Logger;
  nativeTokenDecimals: number;
  procedures: { securedProcedure: any };
  tokenPriceApiUrl: string;
  tokenPriceTokenName: string;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/{id}/snapshot' })
    .input(ClusterIdParamSchema)
    .output(ApiResponseSchema(ClusterSnapshotSchema))
    .handler(async ({ context, input }: any) => {
      try {
        const ownershipError = await requireOwnedCluster(
          params.clusterStorage,
          input.id,
          context.user,
        );
        if (ownershipError) {
          return ownershipError;
        }

        const row = await params.clusterStorage.getClusterSnapshot(input.id);
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
          tokenPrice = await getTokenPrice(
            params.tokenPriceApiUrl,
            params.tokenPriceTokenName,
            params.logger,
          );
        } catch {
          // Keeps the route working when the price feed is temporarily unavailable.
        }

        const toNum = (value: string | null) => (value !== null ? Number(value) : null);
        const toBigStr = (value: bigint | null) =>
          value !== null ? formatBalance(value, params.chain) : null;
        const toExecReward = (value: string | null) =>
          value !== null
            ? { wei: value, token: formatWeiToToken(value, params.nativeTokenDecimals) }
            : null;

        return {
          success: true,
          data: {
            activeCount: Number(row.active_count),
            inactiveCount: Number(row.inactive_count),
            statusBreakdown: JSON.parse(row.beacon_status_breakdown),
            totalBalance: formatBalance(row.total_balance ?? BigInt(0), params.chain),
            totalEffectiveBalance: formatBalance(
              row.total_effective_balance ?? BigInt(0),
              params.chain,
            ),
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
        return {
          success: false,
          error: {
            code: 'SNAPSHOT_ERROR',
            message: error instanceof Error ? error.message : 'Failed to get cluster snapshot',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
