/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOwnedCluster } from './ownership.js';
import {
  ClusterIdParamSchema,
  RemoveValidatorsInputSchema,
  RemoveValidatorsResponseSchema,
} from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the remove-validators route.
 */
export function createRemoveValidatorsRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'DELETE', path: '/clusters/{id}/validators' })
    .input(ClusterIdParamSchema.merge(RemoveValidatorsInputSchema))
    .output(ApiResponseSchema(RemoveValidatorsResponseSchema))
    .handler(async ({ context, input }: any) => {
      try {
        const ownershipError = await requireOwnedCluster(
          params.clusterStorage,
          input.id,
          context.user,
        );
        if (ownershipError) {
          return ownershipError;
        }

        if (input.withdrawalAddress && input.validatorIndexes) {
          return {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message:
                'Only one of validatorIndexes or withdrawalAddress can be provided, not both',
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        let removed: number;
        if (input.withdrawalAddress) {
          removed = await params.clusterStorage.removeValidatorsByWithdrawalAddress(
            input.id,
            input.withdrawalAddress,
          );
        } else if (input.validatorIndexes) {
          removed = await params.clusterStorage.removeValidatorsByIndexes(
            input.id,
            input.validatorIndexes,
          );
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
        return {
          success: false,
          error: {
            code: 'CLUSTER_REMOVE_VALIDATORS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to remove validators',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
