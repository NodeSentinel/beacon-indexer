import { ORPCError } from '@orpc/server';

import { isOriginAllowed } from './origin.js';
import { authenticateTelegram } from './strategies/telegram.js';
import { authenticateApiKey } from './strategies/token.js';
import type { AuthContext } from './types.js';

import { baseProcedure } from '@/lib/orpc.js';

/**
 * Access control middleware for oRPC.
 *
 * Allows a request through if ANY of these conditions is met:
 *  1. The Origin header matches ALLOWED_ORIGINS
 *  2. A valid API key is provided via Authorization header
 *  3. Valid Telegram initData is provided (for future Telegram Mini App auth)
 */
export const accessMiddleware = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  const authHeader = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const telegramInitData = Array.isArray(headers['x-telegram-init-data'])
    ? headers['x-telegram-init-data'][0]
    : headers['x-telegram-init-data'];

  // 1. Origin whitelist — browser requests from allowed domains
  if (isOriginAllowed(origin)) {
    return next({ context });
  }

  // 2. Telegram Mini App auth
  if (telegramInitData) {
    const user = await authenticateTelegram(telegramInitData);
    return next({
      context: {
        ...context,
        user,
      },
    });
  }

  // 3. API key — non-browser clients
  if (authHeader) {
    authenticateApiKey(authHeader);
    return next({ context });
  }

  throw new ORPCError('UNAUTHORIZED', {
    message: 'Authentication required',
  });
});

/**
 * Telegram-authenticated procedure.
 * Requires valid Telegram initData — use for endpoints that need a user identity.
 */
export const telegramAuthProcedure = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const telegramInitData = Array.isArray(headers['x-telegram-init-data'])
    ? headers['x-telegram-init-data'][0]
    : headers['x-telegram-init-data'];

  if (!telegramInitData) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Telegram authentication required',
    });
  }

  const user: AuthContext['user'] = await authenticateTelegram(telegramInitData);

  return next({
    context: {
      ...context,
      user,
    },
  });
});
