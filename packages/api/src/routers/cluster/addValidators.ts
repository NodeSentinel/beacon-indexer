import { requireOwnedCluster } from './ownership.js';
import {
  AddValidatorsInputSchema,
  AddValidatorsResponseSchema,
  ClusterIdParamSchema,
} from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Add validators to cluster
 * POST /clusters/:id/validators
 *
 * Accepts either:
 * - validatorIndexes: array of validator indexes to add
 * - withdrawalAddress: adds all validators with this withdrawal address (case-insensitive)
 */
export const addValidators = securedProcedure
  .route({ method: 'POST', path: '/clusters/{id}/validators' })
  .input(ClusterIdParamSchema.merge(AddValidatorsInputSchema))
  .output(ApiResponseSchema(AddValidatorsResponseSchema))
  .handler(async ({ input, context }) => {
    try {
      const storage = new ClusterStorage();
      let validatorIndexes: number[];

      const ownershipError = await requireOwnedCluster(storage, input.id, context.user);
      if (ownershipError) {
        return ownershipError;
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

      if (input.withdrawalAddress) {
        // Find all validators with this withdrawal address
        validatorIndexes = await storage.findValidatorIndexesByWithdrawalAddress(
          input.withdrawalAddress,
        );

        if (validatorIndexes.length === 0) {
          return {
            success: false,
            error: {
              code: 'VALIDATORS_NOT_FOUND',
              message: `No validators found with withdrawal address ${input.withdrawalAddress}`,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
      } else if (input.validatorIndexes) {
        // Verify all validator indexes exist
        const { existing, notFound } = await storage.verifyValidatorIndexes(input.validatorIndexes);

        if (notFound.length > 0) {
          return {
            success: false,
            error: {
              code: 'VALIDATORS_NOT_FOUND',
              message: `Validators not found: ${notFound.join(', ')}`,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        validatorIndexes = existing;
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

      const added = await storage.addValidators(input.id, validatorIndexes);

      return {
        success: true,
        data: { added },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add validators';
      return {
        success: false,
        error: { code: 'CLUSTER_ADD_VALIDATORS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
