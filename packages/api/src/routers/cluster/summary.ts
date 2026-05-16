/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chain } from '@beacon-indexer/beacon-utils';
import { z } from 'zod';

import { ClusterSummarySchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const ClusterSummaryResponseSchema = ApiResponseSchema(ClusterSummarySchema);
type ClusterSummaryResponse = z.infer<typeof ClusterSummaryResponseSchema>;

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
          totalUsers: summary.totalUsers,
          totalUniqueValidators: summary.totalUniqueValidators,
          totalTokenAmount: formatBalance(summary.totalEffectiveBalance, params.chain),
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
