/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chain } from '@beacon-indexer/beacon-utils';
import { z } from 'zod';

import { ClusterSummarySchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const ClusterSummaryResponseSchema = ApiResponseSchema(ClusterSummarySchema);
type ClusterSummaryResponse = z.infer<typeof ClusterSummaryResponseSchema>;

interface RawClusterSummaryMetric {
  total: number;
  totalUniqueValidators: number;
  totalEffectiveBalance: bigint;
}

/**
 * Formats a raw bigint-backed summary metric for API consumers.
 */
function formatSummaryMetric(
  metric: RawClusterSummaryMetric,
  chain: Chain,
): Omit<RawClusterSummaryMetric, 'totalEffectiveBalance'> & { tokenAmount: string } {
  return {
    total: metric.total,
    totalUniqueValidators: metric.totalUniqueValidators,
    tokenAmount: formatBalance(metric.totalEffectiveBalance, chain),
  };
}

/**
 * Creates the cluster summary route.
 */
export function createClusterSummaryRoute(params: {
  chain: Chain;
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { apiKeyProcedure } = params.procedures;

  return apiKeyProcedure
    .route({ method: 'GET', path: '/clusters/summary' })
    .output(ClusterSummaryResponseSchema)
    .handler(async () => {
      try {
        const summary = await params.clusterStorage.getSummary();

        return successResponse({
          totalClusters: summary.totalClusters,
          activeUsers: {
            ...formatSummaryMetric(summary.activeUsers, params.chain),
            details: {
              telegram: formatSummaryMetric(summary.activeUsers.details.telegram, params.chain),
              lido: formatSummaryMetric(summary.activeUsers.details.lido, params.chain),
              annon: formatSummaryMetric(summary.activeUsers.details.annon, params.chain),
            },
          },
          tgBlockedUsers: formatSummaryMetric(summary.tgBlockedUsers, params.chain),
          inactiveUsers: summary.inactiveUsers,
          clusters: summary.clusters.map((cluster: any) => ({
            id: cluster.id,
            name: cluster.name,
            ownerId: cluster.ownerId,
            ownerUsername: cluster.ownerUsername,
            validatorCount: cluster.validatorCount,
            tokenAmount: formatBalance(cluster.effectiveBalance, params.chain),
          })),
        }) as ClusterSummaryResponse;
      } catch (error) {
        return errorResponse(
          'CLUSTER_SUMMARY_ERROR',
          error instanceof Error ? error.message : 'Failed to get cluster summary',
        ) as ClusterSummaryResponse;
      }
    });
}
