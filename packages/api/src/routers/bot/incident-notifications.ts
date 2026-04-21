import { z } from 'zod';

import { botProcedure } from './procedures.js';
import {
  BotIncidentNotificationListSchema,
  BotNotificationDeliveredSchema,
  BotNotificationListInputSchema,
  IncidentNotificationIdParamSchema,
} from './schemas.js';

import { BotIncidentNotificationsStorage } from '@/storage/bot-incident-notifications.js';
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
 * List pending incident notifications.
 * GET /bot/incident-notifications
 */
export const listBotIncidentNotifications = botProcedure
  .route({ method: 'GET', path: '/bot/incident-notifications' })
  .input(BotNotificationListInputSchema)
  .output(BotIncidentNotificationListResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotIncidentNotificationsStorage();
      const notifications = await storage.listPending(input.limit);

      return successResponse(
        notifications.map((notification) => ({
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

/**
 * Mark an open incident notification as sent.
 * PUT /bot/incident-notifications/{incidentId}/opened
 */
export const markBotIncidentOpenedNotified = botProcedure
  .route({ method: 'PUT', path: '/bot/incident-notifications/{incidentId}/opened' })
  .input(IncidentNotificationIdParamSchema)
  .output(BotIncidentNotificationDeliveredResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotIncidentNotificationsStorage();
      await storage.markOpenedNotified(input.incidentId);

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

/**
 * Mark a closed incident notification as sent.
 * PUT /bot/incident-notifications/{incidentId}/closed
 */
export const markBotIncidentClosedNotified = botProcedure
  .route({ method: 'PUT', path: '/bot/incident-notifications/{incidentId}/closed' })
  .input(IncidentNotificationIdParamSchema)
  .output(BotIncidentNotificationDeliveredResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotIncidentNotificationsStorage();
      await storage.markClosedNotified(input.incidentId);

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
