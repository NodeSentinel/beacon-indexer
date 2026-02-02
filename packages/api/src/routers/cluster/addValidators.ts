import { Prisma } from '@beacon-indexer/db';

import {
  AddValidatorsInputSchema,
  AddValidatorsResponseSchema,
  ClusterIdParamSchema,
} from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Add validators to cluster
 * POST /clusters/:id/validators
 */
export const addValidators = publicProcedure
  .route({ method: 'POST', path: '/clusters/{id}/validators' })
  .input(ClusterIdParamSchema.merge(AddValidatorsInputSchema))
  .output(ApiResponseSchema(AddValidatorsResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const added = await storage.addValidators(input.id, input.validatorIndexes);

      return {
        success: true,
        data: { added },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      // Handle foreign key constraint violation (cluster doesn't exist)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to add validators';
      return {
        success: false,
        error: { code: 'CLUSTER_ADD_VALIDATORS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
