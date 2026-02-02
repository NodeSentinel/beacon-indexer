import { Prisma } from '@beacon-indexer/db';
import { z } from 'zod';

import { RemoveValidatorParamSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Remove a validator from cluster
 * DELETE /clusters/:id/validators/:validatorIndex
 */
export const removeValidator = publicProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}/validators/{validatorIndex}' })
  .input(RemoveValidatorParamSchema)
  .output(ApiResponseSchema(z.object({ removed: z.boolean() })))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      await storage.removeValidator(input.id, input.validatorIndex);

      return {
        success: true,
        data: { removed: true },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      // Handle case where record not found (Prisma P2025)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        // Check if cluster exists to provide accurate error message
        const storage = new ClusterStorage();
        const clusterExists = await storage.findById(input.id);
        if (!clusterExists) {
          return {
            success: false,
            error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        // Cluster exists, so validator was not in it
        return {
          success: false,
          error: {
            code: 'VALIDATOR_NOT_IN_CLUSTER',
            message: `Validator ${input.validatorIndex} is not in cluster ${input.id}`,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to remove validator';
      return {
        success: false,
        error: { code: 'CLUSTER_REMOVE_VALIDATOR_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
