import { ClusterDetailSchema, ClusterIdParamSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Get cluster details with validators
 * GET /clusters/:id
 */
export const getCluster = publicProcedure
  .route({ method: 'GET', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(ClusterDetailSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const cluster = await storage.findByIdWithValidators(input.id);

      if (!cluster) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      const withdrawalAddresses = await storage.getWithdrawalAddresses(input.id);

      return {
        success: true,
        data: {
          id: cluster.id,
          name: cluster.name,
          visibility: cluster.visibility,
          feeRecipientAddress: cluster.feeRecipientAddress,
          ownerId: cluster.ownerId.toString(),
          createdAt: cluster.createdAt.toISOString(),
          validators: cluster.validators,
          withdrawalAddresses,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get cluster';
      return {
        success: false,
        error: { code: 'CLUSTER_GET_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
