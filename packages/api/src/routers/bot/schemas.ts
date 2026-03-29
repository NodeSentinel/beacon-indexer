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
