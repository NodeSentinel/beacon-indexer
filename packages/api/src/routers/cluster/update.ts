/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { validateClusterLidoCsmOperator } from './lido-csm-operator.js';
import { requireOwnedCluster } from './ownership.js';
import { ClusterIdParamSchema, ClusterSchema, UpdateClusterInputSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster update route.
 */
export function createUpdateClusterRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
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

        if (input.lidoCsmOperatorId !== undefined) {
          const storedCluster = await params.clusterStorage.findById(input.id);
          const lidoConflict = validateClusterLidoCsmOperator({
            currentLidoOperatorId: storedCluster?.lidoOperatorId ?? null,
            nextLidoCsmOperatorId: input.lidoCsmOperatorId,
          });

          if (lidoConflict) {
            return {
              success: false,
              error: lidoConflict,
              meta: { timestamp: new Date().toISOString() },
            };
          }
        }

        const updateData: Omit<z.infer<typeof UpdateClusterInputSchema>, 'lidoCsmOperatorId'> = {};
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

        const data = {
          ...updateData,
          validatorIndexes: input.validatorIndexes,
        };
        const cluster =
          input.lidoCsmOperatorId !== undefined
            ? await params.clusterStorage.updateWithValidatorsAndLidoOperator(
                input.id,
                data,
                input.lidoCsmOperatorId,
              )
            : await params.clusterStorage.updateWithValidators(input.id, data);

        return {
          success: true,
          data: {
            id: cluster.id,
            name: cluster.name,
            visibility: cluster.visibility,
            feeRecipientAddress: cluster.feeRecipientAddress,
            lidoOperatorId: cluster.lidoOperatorId,
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
