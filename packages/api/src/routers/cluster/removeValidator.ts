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

      // Check if cluster exists
      const existing = await storage.findById(input.id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      await storage.removeValidator(input.id, input.validatorIndex);

      return {
        success: true,
        data: { removed: true },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      // Handle case where validator wasn't in the cluster
      // Prisma throws: "No record was found for a delete" or similar
      if (
        error instanceof Error &&
        (error.message.includes('not found') || error.message.includes('No record was found'))
      ) {
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
