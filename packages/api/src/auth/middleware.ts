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
 * Resolves an anonymous user from a session UUID into a DB user record.
 */
async function resolveAnonymousUser(sessionId: string) {
  const storage = new UserStorage();
  return storage.getOrCreateAnonymous(sessionId);
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Secured procedure — the default for all endpoints (except health check).
 *
 * Check order matters — Telegram is checked FIRST because its authentication
 * is based on the HMAC signature of initData (signed by the bot token), not by origin.
 *
 *  1. Telegram initData header → validate HMAC, find-or-create DB user in context
 *  2. API key via Authorization header → no user in context
 *  3. Anonymous session header + valid origin → find-or-create anonymous DB user in context
 */
export const securedProcedure = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const telegramInitData = getHeader(headers, 'x-telegram-init-data');
  const authHeader = getHeader(headers, 'authorization');
  const anonymousId = getHeader(headers, 'ns-anonymous-id');
  const origin = getHeader(headers, 'origin');

  // 1. Telegram Mini App auth — highest priority
  if (telegramInitData) {
    const user = await resolveTelegramUser(telegramInitData);
    return next({ context: { ...context, user } });
  }

  // 2. API key — non-browser clients
  if (authHeader) {
    authenticateApiKey(authHeader);
    return next({ context });
  }

  // 3. Anonymous web session — requires valid origin + session UUID
  if (anonymousId && isOriginAllowed(origin)) {
    const user = await resolveAnonymousUser(anonymousId);
    return next({ context: { ...context, user } });
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

  const telegramInitData = getHeader(headers, 'x-telegram-init-data');

  if (!telegramInitData) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Telegram authentication required',
    });
  }

  const user = await resolveTelegramUser(telegramInitData);

  return next({ context: { ...context, user } });
});
