import { Prisma } from '@beacon-indexer/db';
import { z } from 'zod';

import { ClusterIdParamSchema } from './schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
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
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      await storage.delete(input.id);

      return {
        success: true,
        data: { deleted: true },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      // Handle record not found (cluster doesn't exist)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to delete cluster';
      return {
        success: false,
        error: { code: 'CLUSTER_DELETE_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
