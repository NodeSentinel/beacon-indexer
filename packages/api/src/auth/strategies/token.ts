import { ORPCError } from '@orpc/server';

import { env } from '@/config/env.js';

/**
 * Authenticate by comparing the provided token directly against API_TOKEN_SECRET.
 * Used for external/non-browser clients that can't rely on origin whitelisting.
 */
export function authenticateApiKey(header: string): void {
  const token = header.replace(/^Bearer\s+/i, '');

  if (!token || token !== env.API_TOKEN_SECRET) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Invalid API key',
    });
  }
}
