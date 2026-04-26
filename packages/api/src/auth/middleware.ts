/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORPCError } from '@orpc/server';

import { AuthStrategy } from './types.js';

import { baseProcedure, publicProcedure } from '@/lib/orpc.js';
import type { UserStorage } from '@/storage/user.js';

interface AuthProcedureDeps {
  authenticateApiKey: (header: string) => void;
  authenticateBotSignature: (signature: string, telegramId: string, timestamp: string) => void;
  authenticateTelegram: (initData: string) => Promise<{
    telegramId: string;
    username?: string;
  }>;
  isOriginAllowed: (origin: string | undefined) => boolean;
  userStorage: UserStorage;
}

export type ApiProcedures = ReturnType<typeof createAuthProcedures>;

/**
 * Builds the API auth procedures from explicit dependencies.
 */
export function createAuthProcedures(deps: AuthProcedureDeps) {
  /**
   * Reads a string header from the raw request headers.
   */
  function getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * Resolves and upserts the authenticated Telegram user.
   */
  async function resolveTelegramUser(telegramInitData: string) {
    const telegramUser = await deps.authenticateTelegram(telegramInitData);
    return deps.userStorage.getOrCreateTelegram({
      telegramId: telegramUser.telegramId,
      username: telegramUser.username,
    });
  }

  /**
   * Resolves the bot target user when one exists.
   */
  async function resolveBotUser(telegramId: string) {
    return deps.userStorage.findByTelegramId(telegramId);
  }

  /**
   * Resolves and upserts the anonymous browser user.
   */
  async function resolveAnonymousUser(sessionId: string) {
    return deps.userStorage.getOrCreateAnonymous(sessionId);
  }

  const securedProcedure = baseProcedure.use(async ({ context, next }) => {
    const { headers } = context;

    const telegramInitData = getHeader(headers, 'x-telegram-init-data');
    const botSignature = getHeader(headers, 'bot-signature');
    const botUserId = getHeader(headers, 'bot-user-id');
    const botTimestamp = getHeader(headers, 'bot-timestamp');
    const authHeader = getHeader(headers, 'authorization');
    const anonymousId = getHeader(headers, 'ns-anonymous-id');
    const origin = getHeader(headers, 'origin');

    if (telegramInitData) {
      const user = await resolveTelegramUser(telegramInitData);
      return next({ context: { ...context, user, authStrategy: AuthStrategy.TELEGRAM } });
    }

    if (botSignature && botUserId && botTimestamp) {
      deps.authenticateBotSignature(botSignature, botUserId, botTimestamp);
      const user = await resolveBotUser(botUserId);
      return next({
        context: { ...context, user: user ?? undefined, authStrategy: AuthStrategy.BOT_SIGNATURE },
      });
    }

    if (authHeader) {
      deps.authenticateApiKey(authHeader);
      return next({ context: { ...context, authStrategy: AuthStrategy.API_KEY } });
    }

    if (anonymousId && deps.isOriginAllowed(origin)) {
      const user = await resolveAnonymousUser(anonymousId);
      return next({ context: { ...context, user, authStrategy: AuthStrategy.ANONYMOUS } });
    }

    throw new ORPCError('UNAUTHORIZED', {
      message: 'Authentication required',
    });
  });

  const telegramAuthProcedure = baseProcedure.use(async ({ context, next }) => {
    const telegramInitData = getHeader(context.headers, 'x-telegram-init-data');

    if (!telegramInitData) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Telegram authentication required',
      });
    }

    const user = await resolveTelegramUser(telegramInitData);

    return next({ context: { ...context, user, authStrategy: AuthStrategy.TELEGRAM } });
  });

  const apiKeyProcedure = baseProcedure.use(async ({ context, next }) => {
    const authHeader = getHeader(context.headers, 'authorization');

    if (!authHeader) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'API key authentication required',
      });
    }

    deps.authenticateApiKey(authHeader);

    return next({ context: { ...context, authStrategy: AuthStrategy.API_KEY } });
  });

  return {
    apiKeyProcedure,
    publicProcedure,
    securedProcedure,
    telegramAuthProcedure,
  };
}
