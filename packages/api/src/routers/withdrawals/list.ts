import { WithdrawalsInputSchema, WithdrawalsOutputSchema } from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import { requireOwnedCluster } from '@/routers/cluster/ownership.js';
import type { WithdrawalEventRow } from '@/storage/withdrawal.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

/**
 * Creates the paginated operator withdrawal requests route.
 */
export function createListWithdrawalsRoute(
  params: Pick<
    ApiDependencies,
    'beaconHelpers' | 'chain' | 'clusterStorage' | 'procedures' | 'withdrawalStorage'
  >,
) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/withdrawals' })
    .input(WithdrawalsInputSchema)
    .output(ApiResponseSchema(WithdrawalsOutputSchema))
    .handler(async ({ context, input }) => {
      const ownershipError = await requireOwnedCluster(
        params.clusterStorage,
        input.clusterId,
        context.user,
      );
      if (ownershipError) {
        return ownershipError;
      }

      try {
        const { hasNextPage, rows } = await params.withdrawalStorage.getWithdrawals({
          clusterId: input.clusterId,
          page: input.page,
          pageSize: PAGE_SIZE,
        });

        return {
          success: true,
          data: {
            withdrawals: rows.map((row: WithdrawalEventRow) => ({
              slot: row.slot,
              requestIndex: row.request_index,
              type: row.amount === BigInt(0) ? ('full_exit' as const) : ('partial' as const),
              validatorIndex: row.validator_index,
              pubkey: row.pubkey,
              sourceAddress: row.source_address,
              amount: formatBalance(row.amount, params.chain),
              timestamp: params.beaconHelpers.beaconTime.getTimestampFromSlotNumber(row.slot),
            })),
            hasNextPage,
            page: input.page,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'WITHDRAWALS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to fetch withdrawals',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
