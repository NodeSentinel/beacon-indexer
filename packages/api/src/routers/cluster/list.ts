/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { ClusterWithCountSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster listing route.
 */
export function createListClustersRoute(params: {
  clusterStorage: any;
  procedures: { securedProcedure: any };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters' })
    .output(ApiResponseSchema(z.array(ClusterWithCountSchema)))
    .handler(async ({ context }: any) => {
      try {
        const clusters = await params.clusterStorage.listByOwner(context.user!.id);

        return {
          success: true,
          data: clusters.map((cluster: any) => ({
            id: cluster.id,
            name: cluster.name,
            visibility: cluster.visibility,
            feeRecipientAddress: cluster.feeRecipientAddress,
            ownerId: cluster.ownerId,
            createdAt: cluster.createdAt.toISOString(),
            validatorCount: cluster._count.validators,
          })),
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_LIST_ERROR',
            message: error instanceof Error ? error.message : 'Failed to list clusters',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
