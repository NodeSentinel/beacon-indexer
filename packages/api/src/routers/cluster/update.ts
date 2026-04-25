/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { requireOwnedCluster } from './ownership.js';
import { ClusterIdParamSchema, ClusterSchema, UpdateClusterInputSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster update route.
 */
export function createUpdateClusterRoute(params: {
  clusterStorage: any;
  procedures: { securedProcedure: any };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'PUT', path: '/clusters/{id}' })
    .input(ClusterIdParamSchema.merge(UpdateClusterInputSchema))
    .output(ApiResponseSchema(ClusterSchema))
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

        const updateData: z.infer<typeof UpdateClusterInputSchema> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.visibility !== undefined) updateData.visibility = input.visibility;
        if (input.feeRecipientAddress !== undefined) {
          updateData.feeRecipientAddress = input.feeRecipientAddress;
        }

        if (input.validatorIndexes !== undefined) {
          const { notFound } = await params.clusterStorage.verifyValidatorIndexes(
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
        }

        const cluster = await params.clusterStorage.updateWithValidators(input.id, {
          ...updateData,
          validatorIndexes: input.validatorIndexes,
        });

        return {
          success: true,
          data: {
            id: cluster.id,
            name: cluster.name,
            visibility: cluster.visibility,
            feeRecipientAddress: cluster.feeRecipientAddress,
            ownerId: cluster.ownerId,
            createdAt: cluster.createdAt.toISOString(),
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_UPDATE_ERROR',
            message: error instanceof Error ? error.message : 'Failed to update cluster',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
