import { z } from 'zod';

import { ClusterIdParamSchema, ClusterSchema, UpdateClusterInputSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Update cluster
 * PUT /clusters/:id
 */
export const updateCluster = publicProcedure
  .route({ method: 'PUT', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema.merge(UpdateClusterInputSchema))
  .output(ApiResponseSchema(ClusterSchema))
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

      // Build update data (only include provided fields)
      const updateData: z.infer<typeof UpdateClusterInputSchema> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.visibility !== undefined) updateData.visibility = input.visibility;
      if (input.feeRecipientAddress !== undefined)
        updateData.feeRecipientAddress = input.feeRecipientAddress;

      const cluster = await storage.update(input.id, updateData);

      return {
        success: true,
        data: {
          id: cluster.id,
          name: cluster.name,
          visibility: cluster.visibility,
          feeRecipientAddress: cluster.feeRecipientAddress,
          ownerId: cluster.ownerId.toString(),
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
