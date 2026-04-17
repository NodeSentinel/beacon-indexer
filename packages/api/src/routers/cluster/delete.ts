import { z } from 'zod';

import { requireOwnedCluster } from './ownership.js';
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
      const ownershipError = await requireOwnedCluster(storage, input.id, context.user);
      if (ownershipError) {
        return ownershipError;
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
