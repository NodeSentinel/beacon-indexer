/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import {
  BotIncidentNotificationListSchema,
  BotNotificationDeliveredSchema,
  BotNotificationListInputSchema,
  IncidentNotificationIdParamSchema,
} from './schemas.js';

import type { ApiDependencies } from '@/dependencies.js';
import { createBotProcedure } from '@/routers/bot/procedures.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotIncidentNotificationListResponseSchema = ApiResponseSchema(
  BotIncidentNotificationListSchema,
);
type BotIncidentNotificationListResponse = z.infer<
  typeof BotIncidentNotificationListResponseSchema
>;

const BotIncidentNotificationDeliveredResponseSchema = ApiResponseSchema(
  BotNotificationDeliveredSchema,
);
type BotIncidentNotificationDeliveredResponse = z.infer<
  typeof BotIncidentNotificationDeliveredResponseSchema
>;

/**
 * Creates the bot incident notification routes.
 */
export function createBotIncidentNotificationRoutes(params: {
  botIncidentNotificationsStorage: any;
  procedures: ApiDependencies['procedures'];
}) {
  const botProcedure = createBotProcedure(params.procedures);

  const listBotIncidentNotifications = botProcedure
    .route({ method: 'GET', path: '/bot/incident-notifications' })
    .input(BotNotificationListInputSchema)
    .output(BotIncidentNotificationListResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const notifications = await params.botIncidentNotificationsStorage.listPending(input.limit);

        return successResponse(
          notifications.map((notification: any) => ({
            id: notification.id,
            userId: notification.userId,
            telegramId: notification.user.telegramId.toString(),
            type: notification.type,
            payload: notification.payload,
            createdAt: notification.createdAt.toISOString(),
          })),
        ) as BotIncidentNotificationListResponse;
      } catch (error) {
        return errorResponse(
          'LIST_INCIDENT_NOTIFICATIONS_ERROR',
          error instanceof Error ? error.message : 'Failed to list incident notifications',
        ) as BotIncidentNotificationListResponse;
      }
    });

  const markBotIncidentOpenedNotified = botProcedure
    .route({ method: 'PUT', path: '/bot/incident-notifications/{incidentId}/opened' })
    .input(IncidentNotificationIdParamSchema)
    .output(BotIncidentNotificationDeliveredResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        await params.botIncidentNotificationsStorage.markOpenedNotified(input.incidentId);

        return successResponse({
          id: input.incidentId,
          delivered: true,
        }) as BotIncidentNotificationDeliveredResponse;
      } catch (error) {
        return errorResponse(
          'MARK_INCIDENT_OPENED_NOTIFIED_ERROR',
          error instanceof Error ? error.message : 'Failed to mark open incident notification',
        ) as BotIncidentNotificationDeliveredResponse;
      }
    });

  const markBotIncidentClosedNotified = botProcedure
    .route({ method: 'PUT', path: '/bot/incident-notifications/{incidentId}/closed' })
    .input(IncidentNotificationIdParamSchema)
    .output(BotIncidentNotificationDeliveredResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        await params.botIncidentNotificationsStorage.markClosedNotified(input.incidentId);

        return successResponse({
          id: input.incidentId,
          delivered: true,
        }) as BotIncidentNotificationDeliveredResponse;
      } catch (error) {
        return errorResponse(
          'MARK_INCIDENT_CLOSED_NOTIFIED_ERROR',
          error instanceof Error ? error.message : 'Failed to mark closed incident notification',
        ) as BotIncidentNotificationDeliveredResponse;
      }
    });

  return {
    listBotIncidentNotifications,
    markBotIncidentClosedNotified,
    markBotIncidentOpenedNotified,
  };
}
