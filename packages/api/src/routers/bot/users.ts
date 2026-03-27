import { z } from 'zod';

import { botProcedure } from './procedures.js';
import {
  BotUserListSchema,
  BotUserSchema,
  TelegramIdParamSchema,
  UpdateMessageIdSchema,
} from './schemas.js';

import { BotUsersStorage } from '@/storage/bot-users.js';
import { ApiResponseSchema, successResponse, errorResponse } from '@/utils/response.js';

const BotUserListResponseSchema = ApiResponseSchema(BotUserListSchema);
type BotUserListResponse = z.infer<typeof BotUserListResponseSchema>;

const BotUserResponseSchema = ApiResponseSchema(BotUserSchema);
type BotUserResponse = z.infer<typeof BotUserResponseSchema>;

/**
 * List all notifiable bot users — users with a telegramId, not blocked, and having validators.
 * GET /bot/users
 */
export const listBotUsers = botProcedure
  .route({ method: 'GET', path: '/bot/users' })
  .output(BotUserListResponseSchema)
  .handler(async () => {
    try {
      const storage = new BotUsersStorage();
      const users = await storage.listNotifiableUsers();

      const mapped = users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId!.toString(),
        username: u.username,
        messageId: u.messageId?.toString() ?? null,
      }));

      return successResponse(mapped) as BotUserListResponse;
    } catch (error) {
      return errorResponse(
        'LIST_USERS_ERROR',
        error instanceof Error ? error.message : 'Failed to list bot users',
      ) as BotUserListResponse;
    }
  });

/**
 * Update the pinned message ID for a bot user.
 * PUT /bot/users/{telegramId}/message-id
 */
export const updateBotUserMessageId = botProcedure
  .route({ method: 'PUT', path: '/bot/users/{telegramId}/message-id' })
  .input(UpdateMessageIdSchema)
  .output(BotUserResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotUsersStorage();
      const user = await storage.updateMessageId(BigInt(input.telegramId), input.messageId);

      return successResponse({
        id: user.id,
        telegramId: input.telegramId,
        username: user.username,
        messageId: input.messageId.toString(),
      }) as BotUserResponse;
    } catch (error) {
      return errorResponse(
        'UPDATE_MESSAGE_ID_ERROR',
        error instanceof Error ? error.message : 'Failed to update message ID',
      ) as BotUserResponse;
    }
  });

/**
 * Mark a bot user as blocked (they blocked the bot on Telegram).
 * PUT /bot/users/{telegramId}/blocked
 */
export const setBotUserBlocked = botProcedure
  .route({ method: 'PUT', path: '/bot/users/{telegramId}/blocked' })
  .input(TelegramIdParamSchema)
  .output(BotUserResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotUsersStorage();
      const user = await storage.setBlocked(BigInt(input.telegramId));

      return successResponse({
        id: user.id,
        telegramId: input.telegramId,
        username: user.username,
        messageId: user.messageId?.toString() ?? null,
      }) as BotUserResponse;
    } catch (error) {
      return errorResponse(
        'SET_BLOCKED_ERROR',
        error instanceof Error ? error.message : 'Failed to set user as blocked',
      ) as BotUserResponse;
    }
  });

/**
 * Mark a bot user as unblocked.
 * PUT /bot/users/{telegramId}/unblocked
 */
export const setBotUserUnblocked = botProcedure
  .route({ method: 'PUT', path: '/bot/users/{telegramId}/unblocked' })
  .input(TelegramIdParamSchema)
  .output(BotUserResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotUsersStorage();
      const user = await storage.setUnblocked(BigInt(input.telegramId));

      return successResponse({
        id: user.id,
        telegramId: input.telegramId,
        username: user.username,
        messageId: user.messageId?.toString() ?? null,
      }) as BotUserResponse;
    } catch (error) {
      return errorResponse(
        'SET_UNBLOCKED_ERROR',
        error instanceof Error ? error.message : 'Failed to set user as unblocked',
      ) as BotUserResponse;
    }
  });
