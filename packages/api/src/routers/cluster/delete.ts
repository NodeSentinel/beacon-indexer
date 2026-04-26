/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import { requireOwnedCluster } from './ownership.js';
import { ClusterIdParamSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the cluster deletion route.
 */
export function createDeleteClusterRoute(params: {
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'DELETE', path: '/clusters/{id}' })
    .input(ClusterIdParamSchema)
    .output(ApiResponseSchema(z.object({ deleted: z.boolean() })))
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

        await params.clusterStorage.delete(input.id);

        return {
          success: true,
          data: { deleted: true },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_DELETE_ERROR',
            message: error instanceof Error ? error.message : 'Failed to delete cluster',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
