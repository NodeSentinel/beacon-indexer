import { ORPCError } from '@orpc/server';

import { authenticateTelegram } from './strategies/telegram.js';
import { authenticateToken } from './strategies/token.js';
import type { AuthContext } from './types.js';

import { baseProcedure } from '@/lib/orpc.js';

/**
 * Authentication middleware for oRPC
 * Supports multiple authentication strategies
 */
export const authMiddleware = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  // Extract authorization header
  const authHeader = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;

  // Extract telegram init data (for Telegram Mini Apps)
  const telegramInitData = Array.isArray(headers['x-telegram-init-data'])
    ? headers['x-telegram-init-data'][0]
    : headers['x-telegram-init-data'];

  let user: AuthContext['user'];

  // Try Telegram authentication first
  if (telegramInitData) {
    user = await authenticateTelegram(telegramInitData);
  }
  // Then try token authentication
  else if (authHeader) {
    user = await authenticateToken(authHeader);
  }
  // No authentication provided
  else {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Authentication required',
    });
  }

  // Add user to context
  return next({
    context: {
      ...context,
      user,
    },
  });
});

/**
 * Protected procedure that requires authentication
 * Use this as base for all authenticated endpoints
 */
export const protectedProcedure = authMiddleware;

/**
 * Optional auth middleware - adds user to context if authenticated, but doesn't require it
 */
export const optionalAuthMiddleware = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const authHeader = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;

  const telegramInitData = Array.isArray(headers['x-telegram-init-data'])
    ? headers['x-telegram-init-data'][0]
    : headers['x-telegram-init-data'];

  let user: AuthContext['user'] | null = null;

  try {
    if (telegramInitData) {
      user = await authenticateTelegram(telegramInitData);
    } else if (authHeader) {
      user = await authenticateToken(authHeader);
    }
  } catch {
    // Ignore authentication errors for optional auth
    user = null;
  }

  return next({
    context: {
      ...context,
      user,
    },
  });
});
