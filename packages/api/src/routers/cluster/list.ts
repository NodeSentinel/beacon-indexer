import { z } from 'zod';

import { ClusterWithCountSchema, ListClustersInputSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * List clusters for a given owner
 * GET /clusters?ownerId=X
 */
export const listClusters = publicProcedure
  .route({ method: 'GET', path: '/clusters' })
  .input(ListClustersInputSchema)
  .output(ApiResponseSchema(z.array(ClusterWithCountSchema)))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const clusters = await storage.listByOwner(BigInt(input.ownerId));

      return {
        success: true,
        data: clusters.map((cluster) => ({
          id: cluster.id,
          name: cluster.name,
          visibility: cluster.visibility,
          feeRecipientAddress: cluster.feeRecipientAddress,
          ownerId: cluster.ownerId.toString(),
          createdAt: cluster.createdAt.toISOString(),
          validatorCount: cluster._count.validators,
        })),
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list clusters';
      return {
        success: false,
        error: { code: 'CLUSTER_LIST_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
