import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const serverEnv = {
  // Database
  DATABASE_URL: z.string().url(),

  // Server
  API_PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Auth
  API_TOKEN_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  ALLOWED_ORIGINS: z.string(),

  // Logging
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Chain config
  CHAIN: z.enum(['ethereum', 'gnosis']),
  CONSENSUS_LOOKBACK_SLOT: z.coerce.number().int().min(0).default(0),
  EXECUTION_RPC_URL: z.string().url(),
  NATIVE_TOKEN_DECIMALS: z.coerce.number().int().min(0).default(18),

  // Coingecko
  COINGECKO_TOKEN_PRICE_API_URL: z.string().url(),
  COINGECKO_TOKEN_NAME: z.string().min(1),

  // Gnosis claim execution
  NODE_SENTINEL_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Private key must be a 0x-prefixed 32-byte hex string')
    .optional(),
  EXECUTION_EXPLORER_URL: z.string().url().optional(),
};

/**
 * Validates API runtime environment variables.
 */
export function parseApiEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    clientPrefix: 'IF_NOT_PROVIDED_IT_FAILS',
    client: {},
    server: serverEnv,
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export const env = parseApiEnv();
