import { ClusterIncidentsInputSchema, ClusterIncidentsResponseSchema } from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { IncidentStorage } from '@/storage/incident.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const PAGE_SIZE = 10;

export const listClusterIncidents = securedProcedure
  .route({ method: 'GET', path: '/clusters/{id}/events/incidents' })
  .input(ClusterIncidentsInputSchema)
  .output(ApiResponseSchema(ClusterIncidentsResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new IncidentStorage();
      const { rows, totalCount } = await storage.listClusterIncidents({
        clusterId: input.id,
        page: input.page,
        pageSize: PAGE_SIZE,
      });

      return {
        success: true,
        data: {
          incidents: rows.map((row) => ({
            id: row.id,
            status: row.status,
            openedAt: row.opened_at.toISOString(),
            openedSlot: row.opened_slot,
            openedValidatorIndexes: row.opened_validator_indexes,
            currentValidatorIndexes: row.current_validator_indexes,
            affectedValidatorIndexes: row.affected_validator_indexes,
            closedAt: row.closed_at?.toISOString() ?? null,
            closedSlot: row.closed_slot,
            durationSlots: row.duration_slots,
            durationSeconds: row.duration_seconds,
            missedAttestations: row.missed_attestations,
            missedConsensusRewards:
              row.missed_consensus_rewards !== null
                ? formatBalance(row.missed_consensus_rewards)
                : null,
          })),
          totalCount,
          page: input.page,
          pageSize: PAGE_SIZE,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch cluster incidents';
      return {
        success: false,
        error: { code: 'CLUSTER_INCIDENTS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
