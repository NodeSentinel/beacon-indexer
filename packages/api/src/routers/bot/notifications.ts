import { z } from 'zod';

import { botProcedure } from './procedures.js';
import {
  BotNotificationDeletedSchema,
  BotNotificationDeliveredSchema,
  BotNotificationListInputSchema,
  BotNotificationListSchema,
  NotificationIdParamSchema,
} from './schemas.js';

import { BotNotificationsStorage } from '@/storage/bot-notifications.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotNotificationListResponseSchema = ApiResponseSchema(BotNotificationListSchema);
type BotNotificationListResponse = z.infer<typeof BotNotificationListResponseSchema>;

const BotNotificationDeliveredResponseSchema = ApiResponseSchema(BotNotificationDeliveredSchema);
type BotNotificationDeliveredResponse = z.infer<typeof BotNotificationDeliveredResponseSchema>;

const BotNotificationDeletedResponseSchema = ApiResponseSchema(BotNotificationDeletedSchema);
type BotNotificationDeletedResponse = z.infer<typeof BotNotificationDeletedResponseSchema>;

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
  .output(BotNotificationDeliveredResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotNotificationsStorage();
      await storage.markDelivered(input.id);

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

/**
 * Delete a bot notification.
 * DELETE /bot/notifications/{id}
 */
export const deleteBotNotification = botProcedure
  .route({ method: 'DELETE', path: '/bot/notifications/{id}' })
  .input(NotificationIdParamSchema)
  .output(BotNotificationDeletedResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotNotificationsStorage();
      await storage.delete(input.id);

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
