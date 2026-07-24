import { WithdrawalsInputSchema, WithdrawalsOutputSchema } from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import type { WithdrawalEventRow } from '@/storage/withdrawal.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

type WithdrawalSource = 'payload' | 'execution_request';

/**
 * Converts compact database source labels into API source labels.
 */
function formatWithdrawalSource(source: string): WithdrawalSource {
  return source === 'request' ? 'execution_request' : 'payload';
}

/**
 * Creates the paginated withdrawals route.
 */
export function createListWithdrawalsRoute(
  params: Pick<ApiDependencies, 'beaconHelpers' | 'chain' | 'procedures' | 'withdrawalStorage'>,
) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/withdrawals' })
    .input(WithdrawalsInputSchema)
    .output(ApiResponseSchema(WithdrawalsOutputSchema))
    .handler(async ({ input }) => {
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
              source: formatWithdrawalSource(row.source),
              index: row.event_index,
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
