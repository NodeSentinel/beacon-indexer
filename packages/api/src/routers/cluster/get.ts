/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOwnedCluster } from './ownership.js';
import { ClusterDetailSchema, ClusterIdParamSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

/**
 * Creates the cluster detail route.
 */
export function createGetClusterRoute(params: {
  chain: 'ethereum' | 'gnosis';
  clusterStorage: any;
  procedures: ApiProcedures;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/clusters/{id}' })
    .input(ClusterIdParamSchema)
    .output(ApiResponseSchema(ClusterDetailSchema))
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

        const cluster = await params.clusterStorage.findByIdWithValidatorsAndSnapshot(input.id);

        if (!cluster) {
          return {
            success: false,
            error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        const withdrawalAddresses = Array.from(
          new Set<string>(
            cluster.validators.flatMap((validator: any) =>
              validator.withdrawalAddress ? [validator.withdrawalAddress] : [],
            ),
          ),
        );

        let totalBalance = BigInt(0);
        let totalEffectiveBalance = BigInt(0);

        for (const validator of cluster.validators) {
          totalBalance += validator.balance;
          if (validator.effectiveBalance) {
            totalEffectiveBalance += validator.effectiveBalance;
          }
        }

        return {
          success: true,
          data: {
            id: cluster.id,
            name: cluster.name,
            visibility: cluster.visibility as 'private' | 'shared',
            feeRecipientAddress: cluster.feeRecipientAddress,
            ownerId: cluster.ownerId,
            createdAt: cluster.createdAt.toISOString(),
            validators: cluster.validators.map((validator: any) => ({
              validatorIndex: validator.validatorIndex,
              withdrawalAddress: validator.withdrawalAddress,
              status: validator.beaconStatus,
              isInactive: validator.isInactive,
              performanceH: validator.performanceH,
              balance: formatBalance(validator.balance, params.chain),
              effectiveBalance: validator.effectiveBalance
                ? formatBalance(validator.effectiveBalance, params.chain)
                : null,
              pubkey: validator.pubkey,
            })),
            withdrawalAddresses,
            totalBalance: formatBalance(totalBalance, params.chain),
            totalEffectiveBalance: formatBalance(totalEffectiveBalance, params.chain),
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CLUSTER_GET_ERROR',
            message: error instanceof Error ? error.message : 'Failed to get cluster',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
