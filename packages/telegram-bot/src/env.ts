import { createEnv } from '@t3-oss/env-core';
import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file in the telegram-bot package root
config({ path: new URL('../.env', import.meta.url) });

// Telegram allowed update types
// https://core.telegram.org/bots/api#update
const allowedUpdateTypes = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'message_reaction',
  'message_reaction_count',
  'inline_query',
  'chosen_inline_result',
  'callback_query',
  'shipping_query',
  'pre_checkout_query',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'chat_boost',
  'removed_chat_boost',
  'purchased_paid_media',
] as const;

export type AllowedUpdateType = (typeof allowedUpdateTypes)[number];

export const env = createEnv({
  clientPrefix: 'IF_NOT_PROVIDED_IT_FAILS',
  client: {},
  server: {
    // Chain Configuration
    CHAIN: z.enum(['ethereum', 'gnosis']).default('gnosis'),

    // API Configuration
    API_URL: z.string().url(),

    // Bot Configuration
    BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, 'Invalid bot token format'),
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    BOT_ALLOWED_UPDATES: z
      .string()
      .default('[]')
      .transform((val) => {
        const parsed = JSON.parse(val) as string[];
        // Validate that all values are valid update types
        parsed.forEach((update) => {
          if (!allowedUpdateTypes.includes(update as AllowedUpdateType)) {
            throw new Error(
              `Invalid update type: ${update}. Must be one of: ${allowedUpdateTypes.join(', ')}`,
            );
          }
        });
        return parsed as readonly AllowedUpdateType[];
      }),
    BOT_ADMINS: z
      .string()
      .default('[]')
      .transform((val) => JSON.parse(val) as number[]),
    BOT_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(30),

    // Webhook Configuration (only used when BOT_MODE=webhook)
    BOT_WEBHOOK: z.string().url().optional(),
    BOT_WEBHOOK_SECRET: z.string().min(12).optional(),
    SERVER_HOST: z.string().default('0.0.0.0'),
    SERVER_PORT: z.coerce.number().default(80),

    // Logging
    DEBUG: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
