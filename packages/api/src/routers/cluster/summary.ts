import { z } from 'zod';

import { ClusterSummarySchema } from './schemas.js';

import { apiKeyProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const ClusterSummaryResponseSchema = ApiResponseSchema(ClusterSummarySchema);
type ClusterSummaryResponse = z.infer<typeof ClusterSummaryResponseSchema>;

/**
 * Returns a cross-user summary of clusters and validator counts.
 * GET /clusters/summary
 */
export const getClusterSummary = apiKeyProcedure
  .route({ method: 'GET', path: '/clusters/summary' })
  .output(ClusterSummaryResponseSchema)
  .handler(async () => {
    try {
      const storage = new ClusterStorage();
      const summary = await storage.getSummary();

      return successResponse(summary) as ClusterSummaryResponse;
    } catch (error) {
      return errorResponse(
        'CLUSTER_SUMMARY_ERROR',
        error instanceof Error ? error.message : 'Failed to get cluster summary',
      ) as ClusterSummaryResponse;
    }
  });
