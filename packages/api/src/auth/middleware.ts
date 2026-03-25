import { ORPCError } from '@orpc/server';

import { isOriginAllowed } from './origin.js';
import { authenticateTelegram } from './strategies/telegram.js';
import { authenticateApiKey } from './strategies/token.js';

import { baseProcedure } from '@/lib/orpc.js';
import { UserStorage } from '@/storage/user.js';

/**
 * Resolves a Telegram user from initData into a DB user record.
 * Validates the HMAC signature, then find-or-creates the user in the database.
 */
async function resolveTelegramUser(telegramInitData: string) {
  const tgUser = await authenticateTelegram(telegramInitData);
  const storage = new UserStorage();
  return storage.getOrCreateTelegram({
    telegramId: tgUser.telegramId,
    username: tgUser.username,
  });
}

/**
 * Secured procedure — the default for all endpoints (except health check).
 *
 * Check order matters — Telegram is checked FIRST because its authentication
 * is based on the HMAC signature of initData (signed by the bot token), not by origin.
 *
 *  1. Telegram initData header → validate HMAC, find-or-create DB user in context
 *  2. API key via Authorization header → no user in context
 *  3. Origin whitelist → no user in context (anonymous web flow)
 */
export const securedProcedure = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const telegramInitData = Array.isArray(headers['x-telegram-init-data'])
    ? headers['x-telegram-init-data'][0]
    : headers['x-telegram-init-data'];
  const authHeader = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;

  // 1. Telegram Mini App auth — highest priority
  if (telegramInitData) {
    const user = await resolveTelegramUser(telegramInitData);
    return next({
      context: {
        ...context,
        user,
      },
    });
  }

  // 2. API key — non-browser clients
  if (authHeader) {
    authenticateApiKey(authHeader);
    return next({ context });
  }

  // 3. Origin whitelist — browser requests from allowed domains
  if (isOriginAllowed(origin)) {
    return next({ context });
  }

  throw new ORPCError('UNAUTHORIZED', {
    message: 'Authentication required',
  });
});

/**
 * Telegram-authenticated procedure.
 * Requires valid Telegram initData — use for endpoints that need a guaranteed user identity.
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

  const user = await resolveTelegramUser(telegramInitData);

  return next({
    context: {
      ...context,
      user,
    },
  });
});
