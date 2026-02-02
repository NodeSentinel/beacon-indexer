import { Prisma } from '@beacon-indexer/db';

import {
  ClusterIdParamSchema,
  RemoveValidatorsInputSchema,
  RemoveValidatorsResponseSchema,
} from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Remove validators from cluster
 * DELETE /clusters/:id/validators
 *
 * Accepts either:
 * - validatorIndexes: array of validator indexes to remove
 * - withdrawalAddress: removes all validators with this withdrawal address (case-insensitive)
 */
export const removeValidators = publicProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}/validators' })
  .input(ClusterIdParamSchema.merge(RemoveValidatorsInputSchema))
  .output(ApiResponseSchema(RemoveValidatorsResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();

      // Check if cluster exists first
      const cluster = await storage.findById(input.id);
      if (!cluster) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      let removed: number;

      if (input.withdrawalAddress) {
        // Remove all validators with this withdrawal address
        removed = await storage.removeValidatorsByWithdrawalAddress(
          input.id,
          input.withdrawalAddress,
        );
      } else if (input.validatorIndexes) {
        // Remove specific validators by index
        removed = await storage.removeValidatorsByIndexes(input.id, input.validatorIndexes);
      } else {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Either validatorIndexes or withdrawalAddress must be provided',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      return {
        success: true,
        data: { removed },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to remove validators';
      return {
        success: false,
        error: { code: 'CLUSTER_REMOVE_VALIDATORS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
