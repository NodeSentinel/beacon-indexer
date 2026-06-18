import { ORPCError } from '@orpc/server';

export interface ApiKeyAuthenticator {
  authenticateApiKey: (header: string) => void;
}

/**
 * Creates the API key authentication strategy.
 */
export function createApiKeyAuthenticator(apiTokenSecret: string): ApiKeyAuthenticator {
  /**
   * Authenticates the API key from the Authorization header.
   */
  function authenticateApiKey(header: string): void {
    const token = header.replace(/^Bearer\s+/i, '');

    if (!token || token !== apiTokenSecret) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Invalid API key',
      });
    }
  }

  return {
    authenticateApiKey,
  };
}
