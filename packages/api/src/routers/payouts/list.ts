import { PayoutsInputSchema, PayoutsOutputSchema } from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import { requireOwnedCluster } from '@/routers/cluster/ownership.js';
import type { PayoutEventRow } from '@/storage/payout.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

/**
 * Creates the paginated completed payouts route.
 */
export function createListPayoutsRoute(
  params: Pick<
    ApiDependencies,
    'beaconHelpers' | 'chain' | 'clusterStorage' | 'payoutStorage' | 'procedures'
  >,
) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/payouts' })
    .input(PayoutsInputSchema)
    .output(ApiResponseSchema(PayoutsOutputSchema))
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
        const { hasNextPage, rows } = await params.payoutStorage.getPayouts({
          clusterId: input.clusterId,
          page: input.page,
          pageSize: PAGE_SIZE,
        });

        return {
          success: true,
          data: {
            payouts: rows.map((row: PayoutEventRow) => ({
              slot: row.slot,
              index: row.payout_index,
              validatorIndex: row.validator_index,
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
            code: 'PAYOUTS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to fetch payouts',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
