/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOwnedCluster } from './ownership.js';
import { ClearLidoCsmOperatorInputSchema, ClearLidoCsmOperatorResponseSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { getOperatorActivePubkeys } from '@/services/lido/get-operator-active-pubkeys.js';
import { ApiResponseSchema } from '@/utils/response.js';

type LidoValidatorStorage = {
  findByPubkeys: (
    pubkeys: string[],
  ) => Promise<Array<{ index: number; pubkey: string | null; withdrawalAddress: string | null }>>;
};

type LidoClusterStorage = {
  clearLidoOperatorFromOwnedCluster: (
    clusterId: string,
    ownerId: string,
    validatorIndexes: number[],
  ) => Promise<{
    cluster: { id: string; lidoOperatorId: string | null };
    removedValidatorCount: number;
  }>;
};

type LidoClusterRouteStorage = LidoClusterStorage & {
  existsForOwner: (id: string, ownerId: string) => Promise<boolean>;
  findById: (id: string) => Promise<{ id: string; lidoOperatorId: string | null } | null>;
};

/**
 * Clears the cluster Lido CSM operator and removes linked validators from one owned cluster.
 */
export async function clearLidoCsmOperatorForCluster(params: {
  clusterId: string;
  clusterStorage: LidoClusterStorage;
  executionRpcUrl: string;
  lidoOperatorId: string | null;
  resolveLidoPubkeys?: typeof getOperatorActivePubkeys;
  userId: string;
  validatorStorage: LidoValidatorStorage;
}) {
  if (params.lidoOperatorId === null) {
    throw new Error('Lido CSM operator id is required');
  }

  const removedValidatorIndexes: number[] = [];

  const resolveLidoPubkeys = params.resolveLidoPubkeys ?? getOperatorActivePubkeys;
  try {
    // Resolves the operator validators so cleanup can remove the linked memberships.
    const pubkeys = await resolveLidoPubkeys({
      operatorId: Number(params.lidoOperatorId),
      rpcUrl: params.executionRpcUrl,
    });
    const validators = await params.validatorStorage.findByPubkeys(pubkeys);

    removedValidatorIndexes.push(...validators.map((validator) => validator.index));
  } catch {
    // Keeps the cluster recoverable when the external Lido RPC lookup is unavailable.
  }

  const { cluster } = await params.clusterStorage.clearLidoOperatorFromOwnedCluster(
    params.clusterId,
    params.userId,
    removedValidatorIndexes,
  );

  return {
    ...cluster,
    removedValidatorIndexes,
  };
}

/**
 * Creates the route that clears one cluster's Lido CSM operator id.
 */
export function createClearLidoCsmOperatorRoute(params: {
  clusterStorage: LidoClusterRouteStorage;
  executionRpcUrl: string;
  procedures: ApiProcedures;
  validatorStorage: LidoValidatorStorage;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'DELETE', path: '/clusters/{id}/lido-csm-operator' })
    .input(ClearLidoCsmOperatorInputSchema)
    .output(ApiResponseSchema(ClearLidoCsmOperatorResponseSchema))
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

        const cluster = await clearLidoCsmOperatorForCluster({
          clusterId: input.id,
          clusterStorage: params.clusterStorage,
          executionRpcUrl: params.executionRpcUrl,
          lidoOperatorId: (await params.clusterStorage.findById(input.id))?.lidoOperatorId ?? null,
          userId: context.user!.id,
          validatorStorage: params.validatorStorage,
        });

        return {
          success: true,
          data: {
            id: cluster.id,
            lidoOperatorId: cluster.lidoOperatorId,
            removedValidatorIndexes: cluster.removedValidatorIndexes,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_LIDO_CSM_CLEAR_ERROR',
            message:
              error instanceof Error ? error.message : 'Failed to clear Lido CSM operator id',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
