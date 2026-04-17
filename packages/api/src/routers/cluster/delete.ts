import { z } from 'zod';

import { ClusterIdParamSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Delete cluster
 * DELETE /clusters/:id
 */
export const deleteCluster = securedProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(z.object({ deleted: z.boolean() })))
  .handler(async ({ input, context }) => {
    try {
      const storage = new ClusterStorage();

      // Require a resolved user so cluster ownership can be enforced.
      if (!context.user) {
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      // Reject access to clusters owned by a different user.
      const clusterExistsForOwner = await storage.existsForOwner(input.id, context.user.id);
      if (!clusterExistsForOwner) {
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
