import { ConsolidationsInputSchema, ConsolidationsOutputSchema } from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import type { ConsolidationEventRow } from '@/storage/consolidation.js';
import { ApiResponseSchema } from '@/utils/response.js';

const PAGE_SIZE = 10;

/**
 * Creates the paginated consolidations route.
 */
export function createListConsolidationsRoute(
  params: Pick<ApiDependencies, 'beaconHelpers' | 'consolidationStorage' | 'procedures'>,
) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/consolidations' })
    .input(ConsolidationsInputSchema)
    .output(ApiResponseSchema(ConsolidationsOutputSchema))
    .handler(async ({ input }) => {
      try {
        const { hasNextPage, rows } = await params.consolidationStorage.getConsolidations({
          clusterId: input.clusterId,
          page: input.page,
          pageSize: PAGE_SIZE,
        });

        return {
          success: true,
          data: {
            consolidations: rows.map((row: ConsolidationEventRow) => ({
              slot: row.slot,
              requestIndex: row.request_index,
              sourceAddress: row.source_address,
              sourcePubkey: row.source_pubkey,
              targetPubkey: row.target_pubkey,
              sourceValidatorIndex: row.source_validator_index,
              targetValidatorIndex: row.target_validator_index,
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
            code: 'CONSOLIDATIONS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to fetch consolidations',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
