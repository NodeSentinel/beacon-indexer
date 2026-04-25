import { config } from 'dotenv';
import { z } from 'zod';

/**
 * Validates the API environment variables.
 */
export const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Server
  PORT: z.coerce.number().int().positive().default(3000),
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
  NATIVE_TOKEN_DECIMALS: z.coerce.number().int().min(0).default(18),

  // Coingecko
  COINGECKO_TOKEN_PRICE_API_URL: z.string().url(),
  COINGECKO_TOKEN_NAME: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses the environment from a raw object.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
}

/**
 * Loads dotenv and parses the current process environment.
 */
export function loadEnv(): Env {
  config({ path: new URL('../../.env', import.meta.url) });

  return parseEnv(process.env);
}
