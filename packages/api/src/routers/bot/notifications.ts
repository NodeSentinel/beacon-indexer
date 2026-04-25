/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import {
  BotNotificationDeletedSchema,
  BotNotificationDeliveredSchema,
  BotNotificationListInputSchema,
  BotNotificationListSchema,
  NotificationIdParamSchema,
} from './schemas.js';

import { createBotProcedure } from '@/routers/bot/procedures.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotNotificationListResponseSchema = ApiResponseSchema(BotNotificationListSchema);
type BotNotificationListResponse = z.infer<typeof BotNotificationListResponseSchema>;

const BotNotificationDeliveredResponseSchema = ApiResponseSchema(BotNotificationDeliveredSchema);
type BotNotificationDeliveredResponse = z.infer<typeof BotNotificationDeliveredResponseSchema>;

const BotNotificationDeletedResponseSchema = ApiResponseSchema(BotNotificationDeletedSchema);
type BotNotificationDeletedResponse = z.infer<typeof BotNotificationDeletedResponseSchema>;

/**
 * Creates the bot notification routes.
 */
export function createBotNotificationRoutes(params: {
  botNotificationsStorage: any;
  procedures: any;
}) {
  const botProcedure = createBotProcedure(params.procedures);

  const listBotNotifications = botProcedure
    .route({ method: 'GET', path: '/bot/notifications' })
    .input(BotNotificationListInputSchema)
    .output(BotNotificationListResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const notifications = await params.botNotificationsStorage.listPending(input.limit);

        return successResponse(
          notifications.map((notification: any) => ({
            id: notification.id,
            userId: notification.userId,
            telegramId: notification.user.telegramId!.toString(),
            type: notification.type,
            payload: notification.payload,
            createdAt: notification.createdAt.toISOString(),
          })),
        ) as BotNotificationListResponse;
      } catch (error) {
        return errorResponse(
          'LIST_NOTIFICATIONS_ERROR',
          error instanceof Error ? error.message : 'Failed to list bot notifications',
        ) as BotNotificationListResponse;
      }
    });

  const markBotNotificationDelivered = botProcedure
    .route({ method: 'PUT', path: '/bot/notifications/{id}/delivered' })
    .input(NotificationIdParamSchema)
    .output(BotNotificationDeliveredResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        await params.botNotificationsStorage.markDelivered(input.id);

        return successResponse({
          id: input.id,
          delivered: true,
        }) as BotNotificationDeliveredResponse;
      } catch (error) {
        return errorResponse(
          'MARK_NOTIFICATION_DELIVERED_ERROR',
          error instanceof Error ? error.message : 'Failed to mark notification as delivered',
        ) as BotNotificationDeliveredResponse;
      }
    });

  const deleteBotNotification = botProcedure
    .route({ method: 'DELETE', path: '/bot/notifications/{id}' })
    .input(NotificationIdParamSchema)
    .output(BotNotificationDeletedResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        await params.botNotificationsStorage.delete(input.id);

        return successResponse({
          id: input.id,
          deleted: true,
        }) as BotNotificationDeletedResponse;
      } catch (error) {
        return errorResponse(
          'DELETE_NOTIFICATION_ERROR',
          error instanceof Error ? error.message : 'Failed to delete bot notification',
        ) as BotNotificationDeletedResponse;
      }
    });

  return {
    deleteBotNotification,
    listBotNotifications,
    markBotNotificationDelivered,
  };
}
