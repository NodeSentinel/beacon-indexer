import { env } from './env.js';

import type { AllowedUpdateType } from './env.js';

// Type definitions for bot configuration
interface BaseConfig {
  botToken: string;
  botAllowedUpdates: readonly AllowedUpdateType[];
  botAdmins: number[];
  botRateLimitPerSecond: number;
  isDebug: boolean;
  logLevel: string;
}

export type PollingConfig = BaseConfig & {
  botMode: 'polling';
  isWebhookMode: false;
  isPollingMode: true;
};

export type WebhookConfig = BaseConfig & {
  botMode: 'webhook';
  botWebhook: string;
  botWebhookSecret: string;
  serverHost: string;
  serverPort: number;
  isWebhookMode: true;
  isPollingMode: false;
};

export type Config = PollingConfig | WebhookConfig;

// Create config from validated environment variables
function createConfigFromEnv(): Config {
  const baseConfig = {
    botToken: env.BOT_TOKEN as string,
    botAllowedUpdates: env.BOT_ALLOWED_UPDATES,
    botAdmins: env.BOT_ADMINS as number[],
    botRateLimitPerSecond: env.BOT_RATE_LIMIT_PER_SECOND as number,
    isDebug: env.DEBUG as boolean,
    logLevel: env.LOG_LEVEL as string,
  };

  if (env.BOT_MODE === 'webhook') {
    if (!env.BOT_WEBHOOK || !env.BOT_WEBHOOK_SECRET) {
      throw new Error('BOT_WEBHOOK and BOT_WEBHOOK_SECRET are required when BOT_MODE=webhook');
    }

    return {
      ...baseConfig,
      botMode: 'webhook' as const,
      botWebhook: env.BOT_WEBHOOK as string,
      botWebhookSecret: env.BOT_WEBHOOK_SECRET as string,
      serverHost: env.SERVER_HOST as string,
      serverPort: env.SERVER_PORT as number,
      isWebhookMode: true as const,
      isPollingMode: false as const,
    };
  }

  return {
    ...baseConfig,
    botMode: 'polling' as const,
    isWebhookMode: false as const,
    isPollingMode: true as const,
  };
}

export const config = createConfigFromEnv();
