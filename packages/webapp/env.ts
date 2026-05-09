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
    // Base URL for the application
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),

    // API URL for oRPC client
    NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),

    // Chain (determines token symbol: gnosis -> GNO, ethereum -> ETH)
    NEXT_PUBLIC_CHAIN: z.enum(['gnosis', 'ethereum']).default('ethereum'),
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
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_CHAIN: process.env.NEXT_PUBLIC_CHAIN,
  },
});
