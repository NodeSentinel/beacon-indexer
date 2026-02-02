import { z } from 'zod';

import { ClusterIdParamSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Delete cluster
 * DELETE /clusters/:id
 */
export const deleteCluster = publicProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(z.object({ deleted: z.boolean() })))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();

      // Check if cluster exists
      const existing = await storage.findById(input.id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      await storage.delete(input.id);

      return {
        success: true,
        data: { deleted: true },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete cluster';
      return {
        success: false,
        error: { code: 'CLUSTER_DELETE_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
