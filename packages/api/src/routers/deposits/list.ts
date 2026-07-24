import { DepositsInputSchema, DepositsOutputSchema } from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import type { DepositEventRow } from '@/storage/deposit.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

type DepositSource = 'eth1data' | 'execution_request';

/**
 * Converts compact database source codes into API source labels.
 */
function formatDepositSource(source: string): DepositSource {
  return source === 'e' ? 'execution_request' : 'eth1data';
}

/**
 * Creates the paginated deposits route.
 */
export function createListDepositsRoute(
  params: Pick<ApiDependencies, 'beaconHelpers' | 'chain' | 'depositStorage' | 'procedures'>,
) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/deposits' })
    .input(DepositsInputSchema)
    .output(ApiResponseSchema(DepositsOutputSchema))
    .handler(async ({ input }) => {
      try {
        const { hasNextPage, rows } = await params.depositStorage.getDeposits({
          clusterId: input.clusterId,
          page: input.page,
          pageSize: PAGE_SIZE,
        });

        return {
          success: true,
          data: {
            deposits: rows.map((row: DepositEventRow) => ({
              slot: row.slot,
              source: formatDepositSource(row.source),
              index: row.index,
              pubkey: row.pubkey,
              withdrawalCredentials: row.withdrawalCredentials,
              amount: formatBalance(row.amount, params.chain),
              validatorIndex: row.validatorIndex,
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
            code: 'DEPOSITS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to fetch deposits',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
