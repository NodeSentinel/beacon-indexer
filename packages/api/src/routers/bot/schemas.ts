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

export const BotNotificationDeliveredSchema = z.object({
  id: z.string(),
  delivered: z.literal(true),
});

export const BotNotificationDeletedSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});

export const BotNotificationListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const BotIncidentNotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  telegramId: z.string(),
  type: z.enum(['incident_opened', 'incident_closed']),
  payload: z.unknown(),
  createdAt: z.string(),
});

export const BotIncidentNotificationListSchema = z.array(BotIncidentNotificationSchema);

export const IncidentNotificationIdParamSchema = z.object({
  incidentId: z.string().uuid(),
});

export const CommunicationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const CreateBotCommunicationSchema = z.object({
  description: z.string().min(1),
  message: z.string().min(1),
  exclude: z.array(z.string()).default([]),
  onlyTo: z.array(z.string()).default([]),
});

export const BotCommunicationSchema = z.object({
  id: z.number().int().positive(),
  description: z.string(),
  message: z.string(),
  exclude: z.array(z.string()),
  onlyTo: z.array(z.string()),
  sent: z.boolean(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});

export const BotCommunicationListSchema = z.array(BotCommunicationSchema);

export const BotCommunicationDetailsSchema = BotCommunicationSchema.extend({
  recipients: z.array(z.string()),
});

export const BotCommunicationSentSchema = z.object({
  id: z.number().int().positive(),
  sent: z.literal(true),
});
