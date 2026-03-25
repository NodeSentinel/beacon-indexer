import { ClusterDetailSchema, ClusterIdParamSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { ClusterStorage } from '@/storage/cluster.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

/**
 * Get cluster details with validators
 * GET /clusters/:id
 */
export const getCluster = securedProcedure
  .route({ method: 'GET', path: '/clusters/{id}' })
  .input(ClusterIdParamSchema)
  .output(ApiResponseSchema(ClusterDetailSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new ClusterStorage();
      const cluster = await storage.findByIdWithValidatorsAndSnapshot(input.id);

      if (!cluster) {
        return {
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with id ${input.id} not found` },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      const withdrawalAddresses = Array.from(
        new Set(
          cluster.validators.flatMap((v) => (v.withdrawalAddress ? [v.withdrawalAddress] : [])),
        ),
      );

      let totalBalance = BigInt(0);
      let totalEffectiveBalance = BigInt(0);

      for (const v of cluster.validators) {
        totalBalance += v.balance;
        if (v.effectiveBalance) {
          totalEffectiveBalance += v.effectiveBalance;
        }
      }

      return {
        success: true,
        data: {
          id: cluster.id,
          name: cluster.name,
          visibility: cluster.visibility as 'private' | 'shared',
          feeRecipientAddress: cluster.feeRecipientAddress,
          ownerId: cluster.ownerId.toString(),
          createdAt: cluster.createdAt.toISOString(),
          validators: cluster.validators.map((v) => ({
            validatorIndex: v.validatorIndex,
            withdrawalAddress: v.withdrawalAddress,
            status: v.beaconStatus,
            isInactive: v.isInactive,
            performanceH: v.performanceH,
            attestationsMissed: v.attestationsMissed,
            balance: formatBalance(v.balance),
            effectiveBalance: v.effectiveBalance ? formatBalance(v.effectiveBalance) : null,
            pubkey: v.pubkey,
          })),
          withdrawalAddresses,
          totalBalance: formatBalance(totalBalance),
          totalEffectiveBalance: formatBalance(totalEffectiveBalance),
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
