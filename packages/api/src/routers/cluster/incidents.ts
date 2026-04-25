/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import {
  ClusterIncidentAffectedValidatorsInputSchema,
  ClusterIncidentAffectedValidatorsResponseSchema,
  ClusterIncidentIdParamSchema,
  ClusterIncidentNotificationSchema,
  ClusterIncidentsInputSchema,
  ClusterIncidentsResponseSchema,
} from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';
import { formatBalance } from '@/utils/tokenFormat.js';

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
 * Builds the missing-user response for incidents routes.
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
 * Builds the missing-user response for incident notification routes.
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
 * Builds the missing-user response for affected-validator routes.
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
 * Creates the cluster incidents routes.
 */
export function createClusterIncidentRoutes(params: {
  chain: 'ethereum' | 'gnosis';
  incidentStorage: any;
  procedures: { securedProcedure: any };
}) {
  const { securedProcedure } = params.procedures;

  const listClusterIncidents = securedProcedure
    .route({ method: 'GET', path: '/clusters/{id}/incidents' })
    .input(ClusterIncidentsInputSchema)
    .output(ClusterIncidentsApiResponseSchema)
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return missingUserResponse();
      }

      try {
        const { rows, totalCount } = await params.incidentStorage.listClusterIncidents({
          ownerId: context.user.id,
          clusterId: input.id,
          page: input.page,
          pageSize: input.pageSize,
        });

        if (rows.length === 0) {
          const isOwnedCluster = await params.incidentStorage.isOwnedCluster({
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
            incidents: rows.map((row: any) => ({
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
                  ? formatBalance(row.missed_attestation_rewards, params.chain)
                  : null,
              missedSyncRewards:
                row.missed_sync_rewards !== null
                  ? formatBalance(row.missed_sync_rewards, params.chain)
                  : null,
              missedConsensusRewards:
                row.missed_consensus_rewards !== null
                  ? formatBalance(row.missed_consensus_rewards, params.chain)
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

  const markClusterIncidentOpenedNotified = securedProcedure
    .route({ method: 'POST', path: '/clusters/{id}/incidents/opened-notified' })
    .input(ClusterIncidentsInputSchema.pick({ id: true }))
    .output(ClusterIncidentNotificationApiResponseSchema)
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return missingNotificationUserResponse();
      }

      try {
        const updatedIncident = await params.incidentStorage.markOpenIncidentNotified({
          ownerId: context.user.id,
          clusterId: input.id,
          notifiedAt: new Date(),
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
              error instanceof Error
                ? error.message
                : 'Failed to update open incident notification',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });

  const markClusterIncidentClosedNotified = securedProcedure
    .route({ method: 'POST', path: '/clusters/incidents/{incidentId}/closed-notified' })
    .input(ClusterIncidentIdParamSchema)
    .output(ClusterIncidentNotificationApiResponseSchema)
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return missingNotificationUserResponse();
      }

      try {
        const updatedIncident = await params.incidentStorage.markClosedIncidentNotified({
          ownerId: context.user.id,
          incidentId: input.incidentId,
          notifiedAt: new Date(),
        });

        if (!updatedIncident) {
          const incidentStatus = await params.incidentStorage.getOwnedIncidentStatus({
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

  const listIncidentAffectedValidators = securedProcedure
    .route({ method: 'GET', path: '/clusters/incidents/{incidentId}/affected-validators' })
    .input(ClusterIncidentAffectedValidatorsInputSchema)
    .output(ClusterIncidentAffectedValidatorsApiResponseSchema)
    .handler(async ({ context, input }: any) => {
      if (!context.user) {
        return missingValidatorsUserResponse();
      }

      try {
        const { rows, totalCount } = await params.incidentStorage.listIncidentAffectedValidators({
          ownerId: context.user.id,
          incidentId: input.incidentId,
          page: input.page,
          pageSize: input.pageSize,
        });

        if (rows.length === 0) {
          const isOwnedIncident = await params.incidentStorage.isOwnedIncident({
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
            validators: rows.map((row: any) => ({
              validatorIndex: row.validator_index,
              inactiveFromSlot: row.inactive_from_slot,
              inactiveToSlot: row.inactive_to_slot,
              rewardsProcessedThroughSlot: row.rewards_processed_through_slot,
              missedAttestationRewards: formatBalance(row.missed_attestation_rewards, params.chain),
              missedSyncRewards: formatBalance(row.missed_sync_rewards, params.chain),
              missedConsensusRewards: formatBalance(row.missed_consensus_rewards, params.chain),
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

  return {
    listClusterIncidents,
    listIncidentAffectedValidators,
    markClusterIncidentClosedNotified,
    markClusterIncidentOpenedNotified,
  };
}
