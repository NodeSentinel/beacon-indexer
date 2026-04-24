import { z } from 'zod';

import { requireOwnedCluster } from './ownership.js';
import { ClusterIdParamSchema, ClusterSchema, UpdateClusterInputSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Update cluster
 * PUT /clusters/:id
 */
export const updateCluster = securedProcedure
  .route({ method: 'PUT', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema.merge(UpdateClusterInputSchema))
  .output(ApiResponseSchema(ClusterSchema))
  .handler(async ({ context, input }) => {
    try {
      const storage = new ClusterStorage();
      const ownershipError = await requireOwnedCluster(storage, input.id, context.user);
      if (ownershipError) {
        return ownershipError;
      }

      // Build update data (only include provided fields)
      const updateData: z.infer<typeof UpdateClusterInputSchema> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.visibility !== undefined) updateData.visibility = input.visibility;
      if (input.feeRecipientAddress !== undefined)
        updateData.feeRecipientAddress = input.feeRecipientAddress;
      if (input.validatorIndexes !== undefined) {
        // Verifies the full saved validator set before applying the transactional sync.
        const { notFound } = await storage.verifyValidatorIndexes(input.validatorIndexes);

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

      const cluster = await storage.updateWithValidators(input.id, {
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
      const message = error instanceof Error ? error.message : 'Failed to update cluster';
      return {
        success: false,
        error: { code: 'CLUSTER_UPDATE_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
