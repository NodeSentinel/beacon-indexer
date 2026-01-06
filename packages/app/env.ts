import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Type-safe environment variables for Beacon Mini App
 * Uses @t3-oss/env-core for validation and type inference
 */
export const env = createEnv({
  /**
   * Server-side environment variables
   * These are only available on the server and never exposed to the client
   */
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Add your server-only variables here
    // Example: DATABASE_URL: z.string().url(),
  },

  /**
   * Client-side environment variables
   * These are exposed to the browser and must be prefixed with NEXT_PUBLIC_
   */
  client: {
    // Enable Telegram environment mocking in development
    NEXT_PUBLIC_TG_MOCK: z
      .enum(['true', 'false'])
      .default('false')
      .transform((val) => val === 'true'),

    // Base URL for the application
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),

    // Add other public variables here
    // Example: NEXT_PUBLIC_API_URL: z.string().url(),
  },

  /**
   * Prefix for client-side environment variables
   */
  clientPrefix: 'NEXT_PUBLIC_',

  /**
   * Runtime environment variables
   * Map process.env to the schema
   */
  runtimeEnv: {
    // Server
    NODE_ENV: process.env.NODE_ENV,

    // Client (must be prefixed with NEXT_PUBLIC_)
    NEXT_PUBLIC_TG_MOCK: process.env.NEXT_PUBLIC_TG_MOCK,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});
