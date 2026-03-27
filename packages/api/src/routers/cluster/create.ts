import { ClusterSchema, CreateClusterInputSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Create a new cluster
 * POST /clusters
 */
export const createCluster = securedProcedure
  .route({ method: 'POST', path: '/clusters' })
  .input(CreateClusterInputSchema)
  .output(ApiResponseSchema(ClusterSchema))
  .handler(async ({ input, context }) => {
    try {
      const storage = new ClusterStorage();
      const cluster = await storage.create({
        name: input.name,
        ownerId: context.user!.id,
        visibility: input.visibility,
        feeRecipientAddress: input.feeRecipientAddress ?? null,
      });

      await storage.addValidators(cluster.id, input.validatorIndexes);

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
      const message = error instanceof Error ? error.message : 'Failed to create cluster';
      return {
        success: false,
        error: { code: 'CLUSTER_CREATE_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
