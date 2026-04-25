/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

import {
  BotUserListSchema,
  BotUserSchema,
  TelegramIdParamSchema,
  UpdateMessageIdSchema,
} from './schemas.js';

import { createBotProcedure } from '@/routers/bot/procedures.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotUserListResponseSchema = ApiResponseSchema(BotUserListSchema);
type BotUserListResponse = z.infer<typeof BotUserListResponseSchema>;

const BotUserResponseSchema = ApiResponseSchema(BotUserSchema);
type BotUserResponse = z.infer<typeof BotUserResponseSchema>;

/**
 * Creates the bot users routes.
 */
export function createBotUsersRoutes(params: { botUsersStorage: any; procedures: any }) {
  const botProcedure = createBotProcedure(params.procedures);

  const listBotUsers = botProcedure
    .route({ method: 'GET', path: '/bot/users' })
    .output(BotUserListResponseSchema)
    .handler(async () => {
      try {
        return successResponse(
          (await params.botUsersStorage.listNotifiableUsers()).map((user: any) => ({
            id: user.id,
            telegramId: user.telegramId!.toString(),
            username: user.username,
            messageId: user.messageId?.toString() ?? null,
          })),
        ) as BotUserListResponse;
      } catch (error) {
        return errorResponse(
          'LIST_USERS_ERROR',
          error instanceof Error ? error.message : 'Failed to list bot users',
        ) as BotUserListResponse;
      }
    });

  const updateBotUserMessageId = botProcedure
    .route({ method: 'PUT', path: '/bot/users/{telegramId}/message-id' })
    .input(UpdateMessageIdSchema)
    .output(BotUserResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const user = await params.botUsersStorage.updateMessageId(
          BigInt(input.telegramId),
          input.messageId,
        );

        return successResponse({
          id: user.id,
          telegramId: input.telegramId,
          username: user.username,
          messageId: input.messageId ? input.messageId.toString() : null,
        }) as BotUserResponse;
      } catch (error) {
        return errorResponse(
          'UPDATE_MESSAGE_ID_ERROR',
          error instanceof Error ? error.message : 'Failed to update message ID',
        ) as BotUserResponse;
      }
    });

  const setBotUserBlocked = botProcedure
    .route({ method: 'PUT', path: '/bot/users/{telegramId}/blocked' })
    .input(TelegramIdParamSchema)
    .output(BotUserResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const user = await params.botUsersStorage.setBlocked(BigInt(input.telegramId));

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

  const setBotUserUnblocked = botProcedure
    .route({ method: 'PUT', path: '/bot/users/{telegramId}/unblocked' })
    .input(TelegramIdParamSchema)
    .output(BotUserResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const user = await params.botUsersStorage.setUnblocked(BigInt(input.telegramId));

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

  return {
    listBotUsers,
    setBotUserBlocked,
    setBotUserUnblocked,
    updateBotUserMessageId,
  };
}
