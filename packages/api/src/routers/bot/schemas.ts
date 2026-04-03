import { z } from 'zod';

export const BotUserSchema = z.object({
  id: z.string(),
  telegramId: z.string(),
  username: z.string(),
  messageId: z.string().nullable(),
});

export const BotUserListSchema = z.array(BotUserSchema);

export const TelegramIdParamSchema = z.object({
  telegramId: z.string(),
});

export const UpdateMessageIdSchema = z.object({
  telegramId: z.string(),
  messageId: z.number(),
});

export const BotNotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  telegramId: z.string().nullable(),
  type: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});

export const BotNotificationListSchema = z.array(BotNotificationSchema);

export const NotificationIdParamSchema = z.object({
  id: z.string(),
});

export const BotNotificationListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
