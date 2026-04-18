import { ORPCError } from '@orpc/server';

import { isOriginAllowed } from './origin.js';
import { authenticateBotSignature } from './strategies/bot-signature.js';
import { authenticateTelegram } from './strategies/telegram.js';
import { authenticateApiKey } from './strategies/token.js';
import { AuthStrategy } from './types.js';

import { baseProcedure } from '@/lib/orpc.js';
import { UserStorage } from '@/storage/user.js';

async function resolveTelegramUser(telegramInitData: string) {
  const tgUser = await authenticateTelegram(telegramInitData);
  const storage = new UserStorage();
  return storage.getOrCreateTelegram({
    telegramId: tgUser.telegramId,
    username: tgUser.username,
  });
}

async function resolveBotUser(telegramId: string) {
  const storage = new UserStorage();
  return storage.findByTelegramId(telegramId);
}

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
 * Check order:
 *  1. Telegram initData header → validate HMAC, find-or-create DB user
 *  2. Bot-signature headers → validate HMAC, resolve DB user by telegramId
 *  3. API key via Authorization header → no user in context
 *  4. Anonymous session header + valid origin → find-or-create anonymous DB user
 */
export const securedProcedure = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;

  const telegramInitData = getHeader(headers, 'x-telegram-init-data');
  const botSignature = getHeader(headers, 'bot-signature');
  const botUserId = getHeader(headers, 'bot-user-id');
  const botTimestamp = getHeader(headers, 'bot-timestamp');
  const authHeader = getHeader(headers, 'authorization');
  const anonymousId = getHeader(headers, 'ns-anonymous-id');
  const origin = getHeader(headers, 'origin');

  // 1. Telegram Mini App auth — highest priority
  if (telegramInitData) {
    const user = await resolveTelegramUser(telegramInitData);
    return next({ context: { ...context, user, authStrategy: AuthStrategy.TELEGRAM } });
  }

  // 2. Bot-signature auth — bot acting on behalf of a user
  //    The HMAC signature proves the caller is the legitimate bot.
  //    User lookup is best-effort: some bot endpoints (e.g. bot.users)
  //    don't operate on behalf of a specific user.
  if (botSignature && botUserId && botTimestamp) {
    authenticateBotSignature(botSignature, botUserId, botTimestamp);
    const user = await resolveBotUser(botUserId);
    return next({
      context: { ...context, user: user ?? undefined, authStrategy: AuthStrategy.BOT_SIGNATURE },
    });
  }

  // 3. API key — non-browser clients
  if (authHeader) {
    authenticateApiKey(authHeader);
    return next({ context: { ...context, authStrategy: AuthStrategy.API_KEY } });
  }

  // 4. Anonymous web session — requires valid origin + session UUID
  if (anonymousId && isOriginAllowed(origin)) {
    const user = await resolveAnonymousUser(anonymousId);
    return next({ context: { ...context, user, authStrategy: AuthStrategy.ANONYMOUS } });
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

  return next({ context: { ...context, user, authStrategy: AuthStrategy.TELEGRAM } });
});

/**
 * API key authenticated procedure.
 * Requires a valid Authorization header and rejects other auth strategies.
 */
export const apiKeyProcedure = baseProcedure.use(async ({ context, next }) => {
  const { headers } = context;
  const authHeader = getHeader(headers, 'authorization');

  if (!authHeader) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'API key authentication required',
    });
  }

  authenticateApiKey(authHeader);

  return next({ context: { ...context, authStrategy: AuthStrategy.API_KEY } });
});
