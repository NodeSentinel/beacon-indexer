import { z } from 'zod';

import { botProcedure } from './procedures.js';
import {
  BotNotificationListInputSchema,
  BotNotificationListSchema,
  BotNotificationSchema,
  NotificationIdParamSchema,
} from './schemas.js';

import { BotNotificationsStorage } from '@/storage/bot-notifications.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotNotificationListResponseSchema = ApiResponseSchema(BotNotificationListSchema);
type BotNotificationListResponse = z.infer<typeof BotNotificationListResponseSchema>;

const BotNotificationResponseSchema = ApiResponseSchema(BotNotificationSchema);
type BotNotificationResponse = z.infer<typeof BotNotificationResponseSchema>;

/**
 * List pending bot notifications.
 * GET /bot/notifications
 */
export const listBotNotifications = botProcedure
  .route({ method: 'GET', path: '/bot/notifications' })
  .input(BotNotificationListInputSchema)
  .output(BotNotificationListResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotNotificationsStorage();
      const notifications = await storage.listPending(input.limit);

      return successResponse(
        notifications.map((notification) => ({
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

/**
 * Mark a bot notification as delivered.
 * PUT /bot/notifications/{id}/delivered
 */
export const markBotNotificationDelivered = botProcedure
  .route({ method: 'PUT', path: '/bot/notifications/{id}/delivered' })
  .input(NotificationIdParamSchema)
  .output(BotNotificationResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotNotificationsStorage();
      const notification = await storage.markDelivered(input.id);

      return successResponse({
        id: notification.id,
        userId: notification.userId,
        telegramId: null,
        type: notification.type,
        payload: notification.payload,
        createdAt: notification.createdAt.toISOString(),
      }) as BotNotificationResponse;
    } catch (error) {
      return errorResponse(
        'MARK_NOTIFICATION_DELIVERED_ERROR',
        error instanceof Error ? error.message : 'Failed to mark notification as delivered',
      ) as BotNotificationResponse;
    }
  });

/**
 * Delete a bot notification.
 * DELETE /bot/notifications/{id}
 */
export const deleteBotNotification = botProcedure
  .route({ method: 'DELETE', path: '/bot/notifications/{id}' })
  .input(NotificationIdParamSchema)
  .output(BotNotificationResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotNotificationsStorage();
      const notification = await storage.delete(input.id);

      return successResponse({
        id: notification.id,
        userId: notification.userId,
        telegramId: null,
        type: notification.type,
        payload: notification.payload,
        createdAt: notification.createdAt.toISOString(),
      }) as BotNotificationResponse;
    } catch (error) {
      return errorResponse(
        'DELETE_NOTIFICATION_ERROR',
        error instanceof Error ? error.message : 'Failed to delete bot notification',
      ) as BotNotificationResponse;
    }
  });
