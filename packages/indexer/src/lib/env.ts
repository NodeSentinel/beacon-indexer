import { createEnv } from '@t3-oss/env-core';
import { config } from 'dotenv';
import { z } from 'zod';

import { getChainConfig } from '../config/chain.js';

// Load .env from the indexer package root
config({ path: new URL('../../.env', import.meta.url) });

export const env = createEnv({
  clientPrefix: 'IF_NOT_PROVIDED_IT_FAILS',
  client: {},
  server: {
    TZ: z
      .string()
      .default('UTC')
      .transform(() => 'UTC'),

    DATABASE_URL: z.string().url(),

    //LOG_OUTPUT: z.enum(['file', 'console']).optional(),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),

    // Blockchain
    CHAIN: z.enum(['gnosis', 'ethereum']),
    // Blockchain - Consensus layer
    CONSENSUS_LOOKBACK_SLOT: z.preprocess((val) => Number(val), z.number().int().min(0)),
    CONSENSUS_ARCHIVE_API_URL: z.string().url(),
    CONSENSUS_ARCHIVE_API_TOKEN: z
      .string()
      .optional()
      .transform((val) => {
        if (!val) return undefined;
        const parts = val.split(':').map((s) => s.trim());
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error('CONSENSUS_ARCHIVE_API_TOKEN must be in format "key: value"');
        }
        return { key: parts[0], value: parts[1] };
      }),
    CONSENSUS_FULL_API_URL: z.string().url(),
    CONSENSUS_API_REQUEST_PER_SECOND: z.preprocess(
      (val) => Number(val),
      z.number().int().positive(),
    ),
    // Blockchain - Execution layer
    EXECUTION_API_URL: z.string().url(),
    EXECUTION_API_KEY: z.string().optional(),
    EXECUTION_API_BKP_URL: z.string().url(),
    EXECUTION_API_BKP_KEY: z.string().optional(),
    EXECUTION_API_REQUEST_PER_SECOND: z.preprocess(
      (val) => Number(val),
      z.number().int().positive(),
    ),
  },
  runtimeEnv: {
    ...process.env,
  },
  emptyStringAsUndefined: true,
});

// Get chain configuration
export const chainConfig = getChainConfig(env.CHAIN);
