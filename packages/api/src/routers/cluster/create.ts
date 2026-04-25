/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClusterWithCountSchema, CreateClusterInputSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster creation route.
 */
export function createCreateClusterRoute(params: {
  clusterStorage: any;
  procedures: { securedProcedure: any };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'POST', path: '/clusters' })
    .input(CreateClusterInputSchema)
    .output(ApiResponseSchema(ClusterWithCountSchema))
    .handler(async ({ context, input }: any) => {
      try {
        const cluster = await params.clusterStorage.create({
          name: input.name,
          ownerId: context.user!.id,
          visibility: input.visibility,
          feeRecipientAddress: input.feeRecipientAddress ?? null,
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
            validatorCount: cluster.validatorCount,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_CREATE_ERROR',
            message: error instanceof Error ? error.message : 'Failed to create cluster',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
