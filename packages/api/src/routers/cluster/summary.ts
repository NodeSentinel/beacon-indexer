/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { ClusterSummarySchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const ClusterSummaryResponseSchema = ApiResponseSchema(ClusterSummarySchema);
type ClusterSummaryResponse = z.infer<typeof ClusterSummaryResponseSchema>;

/**
 * Creates the cluster summary route.
 */
export function createClusterSummaryRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { apiKeyProcedure } = params.procedures;

  return apiKeyProcedure
    .route({ method: 'GET', path: '/clusters/summary' })
    .output(ClusterSummaryResponseSchema)
    .handler(async () => {
      try {
        return successResponse(await params.clusterStorage.getSummary()) as ClusterSummaryResponse;
      } catch (error) {
        return errorResponse(
          'CLUSTER_SUMMARY_ERROR',
          error instanceof Error ? error.message : 'Failed to get cluster summary',
        ) as ClusterSummaryResponse;
      }
    });
}
