import {
  ClusterIdParamSchema,
  RemoveValidatorsInputSchema,
  RemoveValidatorsResponseSchema,
} from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
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
export const removeValidators = securedProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}/validators' })
  .input(ClusterIdParamSchema.merge(RemoveValidatorsInputSchema))
  .output(ApiResponseSchema(RemoveValidatorsResponseSchema))
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

      // Validate that exactly one input type is provided
      if (input.withdrawalAddress && input.validatorIndexes) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Only one of validatorIndexes or withdrawalAddress can be provided, not both',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      // Check if cluster exists (deleteMany doesn't throw for non-existent clusters)
      const clusterExistsForOwner = await storage.existsForOwner(input.id, context.user.id);
      if (!clusterExistsForOwner) {
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
      const message = error instanceof Error ? error.message : 'Failed to remove validators';
      return {
        success: false,
        error: { code: 'CLUSTER_REMOVE_VALIDATORS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
