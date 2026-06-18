/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOwnedCluster } from './ownership.js';
import {
  AddValidatorsInputSchema,
  AddValidatorsResponseSchema,
  ClusterIdParamSchema,
} from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the add-validators route.
 */
export function createAddValidatorsRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'POST', path: '/clusters/{id}/validators' })
    .input(ClusterIdParamSchema.merge(AddValidatorsInputSchema))
    .output(ApiResponseSchema(AddValidatorsResponseSchema))
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

        let validatorIndexes: number[];

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

        if (input.withdrawalAddress) {
          validatorIndexes = await params.clusterStorage.findValidatorIndexesByWithdrawalAddress(
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
          const { existing, notFound } = await params.clusterStorage.verifyValidatorIndexes(
            input.validatorIndexes,
          );

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

        return {
          success: true,
          data: { added: await params.clusterStorage.addValidators(input.id, validatorIndexes) },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_ADD_VALIDATORS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to add validators',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
