import { z } from 'zod';

import { ClusterWithCountSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * List clusters for the current authenticated user
 * GET /clusters
 */
export const listClusters = securedProcedure
  .route({ method: 'GET', path: '/clusters' })
  .output(ApiResponseSchema(z.array(ClusterWithCountSchema)))
  .handler(async ({ context }) => {
    try {
      const storage = new ClusterStorage();
      const clusters = await storage.listByOwner(context.user!.id);

      return {
        success: true,
        data: clusters.map((cluster) => ({
          id: cluster.id,
          name: cluster.name,
          visibility: cluster.visibility,
          feeRecipientAddress: cluster.feeRecipientAddress,
          ownerId: cluster.ownerId,
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
