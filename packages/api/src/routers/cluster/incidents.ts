import { z } from 'zod';

import {
  ClusterIncidentAffectedValidatorsInputSchema,
  ClusterIncidentAffectedValidatorsResponseSchema,
  ClusterIncidentIdParamSchema,
  ClusterIncidentNotificationSchema,
  ClusterIncidentsInputSchema,
  ClusterIncidentsResponseSchema,
} from './schemas.js';

import { securedProcedure } from '@/lib/procedures.js';
import { IncidentStorage } from '@/storage/incident.js';
import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

const incidentStorage = new IncidentStorage();
const ClusterIncidentsApiResponseSchema = ApiResponseSchema(ClusterIncidentsResponseSchema);
const ClusterIncidentNotificationApiResponseSchema = ApiResponseSchema(
  ClusterIncidentNotificationSchema,
);
const ClusterIncidentAffectedValidatorsApiResponseSchema = ApiResponseSchema(
  ClusterIncidentAffectedValidatorsResponseSchema,
);

type ClusterIncidentsApiResponse = z.infer<typeof ClusterIncidentsApiResponseSchema>;
type ClusterIncidentNotificationApiResponse = z.infer<
  typeof ClusterIncidentNotificationApiResponseSchema
>;
type ClusterIncidentAffectedValidatorsApiResponse = z.infer<
  typeof ClusterIncidentAffectedValidatorsApiResponseSchema
>;

/**
 * Returns a success response for a missing authenticated user.
 */
function missingUserResponse(): ClusterIncidentsApiResponse {
  return {
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authenticated user is required for this endpoint',
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Returns a success response for a missing authenticated user on notification routes.
 */
function missingNotificationUserResponse(): ClusterIncidentNotificationApiResponse {
  return {
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authenticated user is required for this endpoint',
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Returns a success response for a missing authenticated user on validator routes.
 */
function missingValidatorsUserResponse(): ClusterIncidentAffectedValidatorsApiResponse {
  return {
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authenticated user is required for this endpoint',
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Lists incidents for one owned cluster.
 */
export const listClusterIncidents = securedProcedure
  .route({ method: 'GET', path: '/clusters/{id}/incidents' })
  .input(ClusterIncidentsInputSchema)
  .output(ClusterIncidentsApiResponseSchema)
  .handler(async ({ context, input }) => {
    if (!context.user) {
      return missingUserResponse();
    }

    try {
      const { rows, totalCount } = await incidentStorage.listClusterIncidents({
        ownerId: context.user.id,
        clusterId: input.id,
        page: input.page,
        pageSize: input.pageSize,
      });

      // This fallback distinguishes an empty page from an unknown or foreign cluster.
      if (rows.length === 0) {
        const isOwnedCluster = await incidentStorage.isOwnedCluster({
          ownerId: context.user.id,
          clusterId: input.id,
        });

        if (!isOwnedCluster) {
          return {
            success: false,
            error: {
              code: 'CLUSTER_NOT_FOUND',
              message: `Cluster with id ${input.id} not found`,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
      }

      return {
        success: true,
        data: {
          incidents: rows.map((row) => ({
            id: row.id,
            status: row.status,
            openedAt: row.opened_at.toISOString(),
            openedSlot: row.opened_slot,
            closedAt: row.closed_at?.toISOString() ?? null,
            closedSlot: row.closed_slot,
            durationSlots: row.duration_slots,
            durationSeconds: row.duration_seconds,
            missedAttestationRewards:
              row.missed_attestation_rewards !== null
                ? formatBalance(row.missed_attestation_rewards)
                : null,
            missedSyncRewards:
              row.missed_sync_rewards !== null ? formatBalance(row.missed_sync_rewards) : null,
            missedConsensusRewards:
              row.missed_consensus_rewards !== null
                ? formatBalance(row.missed_consensus_rewards)
                : null,
            rewardsFinalized: row.rewards_finalized,
            rewardsFinalizedAt: row.rewards_finalized_at?.toISOString() ?? null,
            openedNotificationQueuedAt: row.opened_notification_queued_at?.toISOString() ?? null,
            closedNotificationQueuedAt: row.closed_notification_queued_at?.toISOString() ?? null,
          })),
          totalCount,
          page: input.page,
          pageSize: input.pageSize,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'CLUSTER_INCIDENTS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch cluster incidents',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });

/**
 * Updates the send timestamp for the current open incident in a cluster.
 */
export const markClusterIncidentOpenedNotified = securedProcedure
  .route({ method: 'POST', path: '/clusters/{id}/incidents/opened-notified' })
  .input(ClusterIncidentsInputSchema.pick({ id: true }))
  .output(ClusterIncidentNotificationApiResponseSchema)
  .handler(async ({ context, input }) => {
    if (!context.user) {
      return missingNotificationUserResponse();
    }

    try {
      const notifiedAt = new Date();
      const updatedIncident = await incidentStorage.markOpenIncidentNotified({
        ownerId: context.user.id,
        clusterId: input.id,
        notifiedAt,
      });

      if (!updatedIncident) {
        return {
          success: false,
          error: {
            code: 'OPEN_INCIDENT_NOT_FOUND',
            message: `No open incident found for cluster ${input.id}`,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      return {
        success: true,
        data: {
          incidentId: updatedIncident.incident_id,
          notifiedAt: updatedIncident.opened_notification_queued_at.toISOString(),
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MARK_OPEN_INCIDENT_NOTIFIED_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to update open incident notification',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });

/**
 * Updates the send timestamp for a closed incident.
 */
export const markClusterIncidentClosedNotified = securedProcedure
  .route({ method: 'POST', path: '/clusters/incidents/{incidentId}/closed-notified' })
  .input(ClusterIncidentIdParamSchema)
  .output(ClusterIncidentNotificationApiResponseSchema)
  .handler(async ({ context, input }) => {
    if (!context.user) {
      return missingNotificationUserResponse();
    }

    try {
      const notifiedAt = new Date();
      const updatedIncident = await incidentStorage.markClosedIncidentNotified({
        ownerId: context.user.id,
        incidentId: input.incidentId,
        notifiedAt,
      });

      if (!updatedIncident) {
        const incidentStatus = await incidentStorage.getOwnedIncidentStatus({
          ownerId: context.user.id,
          incidentId: input.incidentId,
        });

        if (!incidentStatus) {
          return {
            success: false,
            error: {
              code: 'INCIDENT_NOT_FOUND',
              message: `Incident with id ${input.incidentId} not found`,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        return {
          success: false,
          error: {
            code: 'INCIDENT_NOT_CLOSED',
            message: `Incident with id ${input.incidentId} is not closed`,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      return {
        success: true,
        data: {
          incidentId: updatedIncident.incident_id,
          notifiedAt: updatedIncident.closed_notification_queued_at.toISOString(),
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MARK_CLOSED_INCIDENT_NOTIFIED_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to update closed incident notification',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });

/**
 * Lists affected validators for one owned incident.
 */
export const listIncidentAffectedValidators = securedProcedure
  .route({ method: 'GET', path: '/clusters/incidents/{incidentId}/affected-validators' })
  .input(ClusterIncidentAffectedValidatorsInputSchema)
  .output(ClusterIncidentAffectedValidatorsApiResponseSchema)
  .handler(async ({ context, input }) => {
    if (!context.user) {
      return missingValidatorsUserResponse();
    }

    try {
      const { rows, totalCount } = await incidentStorage.listIncidentAffectedValidators({
        ownerId: context.user.id,
        incidentId: input.incidentId,
        page: input.page,
        pageSize: input.pageSize,
      });

      // This fallback distinguishes an empty page from an unknown or foreign incident.
      if (rows.length === 0) {
        const isOwnedIncident = await incidentStorage.isOwnedIncident({
          ownerId: context.user.id,
          incidentId: input.incidentId,
        });

        if (!isOwnedIncident) {
          return {
            success: false,
            error: {
              code: 'INCIDENT_NOT_FOUND',
              message: `Incident with id ${input.incidentId} not found`,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
      }

      return {
        success: true,
        data: {
          validators: rows.map((row) => ({
            validatorIndex: row.validator_index,
            inactiveFromSlot: row.inactive_from_slot,
            inactiveToSlot: row.inactive_to_slot,
            rewardsProcessedThroughSlot: row.rewards_processed_through_slot,
            missedAttestationRewards: formatBalance(row.missed_attestation_rewards),
            missedSyncRewards: formatBalance(row.missed_sync_rewards),
            missedConsensusRewards: formatBalance(row.missed_consensus_rewards),
          })),
          totalCount,
          page: input.page,
          pageSize: input.pageSize,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'INCIDENT_AFFECTED_VALIDATORS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch affected validators',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
