/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClusterWithCountSchema, CreateClusterInputSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster creation route.
 */
export function createCreateClusterRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'POST', path: '/clusters' })
    .input(CreateClusterInputSchema)
    .output(ApiResponseSchema(ClusterWithCountSchema))
    .handler(async ({ context, input }: any) => {
      try {
        const data = {
          name: input.name,
          ownerId: context.user!.id,
          visibility: input.visibility,
          feeRecipientAddress: input.feeRecipientAddress ?? null,
          validatorIndexes: input.validatorIndexes,
          lidoCsmOperatorId: input.lidoCsmOperatorId,
        };
        const cluster = await params.clusterStorage.create(data);

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
