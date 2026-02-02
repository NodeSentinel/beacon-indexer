import { Prisma } from '@beacon-indexer/db';

import {
  ClusterIdParamSchema,
  RemoveValidatorsByAddressInputSchema,
  RemoveValidatorsByAddressResponseSchema,
} from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Remove validators from cluster by withdrawal address
 * DELETE /clusters/:id/validators/by-address
 *
 * Removes all validators with the given withdrawal address from the cluster (case-insensitive)
 */
export const removeValidatorsByAddress = publicProcedure
  .route({ method: 'DELETE', path: '/clusters/{id}/validators/by-address' })
  .input(ClusterIdParamSchema.merge(RemoveValidatorsByAddressInputSchema))
  .output(ApiResponseSchema(RemoveValidatorsByAddressResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();

      // Check if cluster exists first
      const cluster = await storage.findById(input.id);
      if (!cluster) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      const removed = await storage.removeValidatorsByWithdrawalAddress(
        input.id,
        input.withdrawalAddress,
      );

      return {
        success: true,
        data: { removed },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to remove validators';
      return {
        success: false,
        error: { code: 'CLUSTER_REMOVE_VALIDATORS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
