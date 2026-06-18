import { RateLimiterMemory, RateLimiterQueue } from 'rate-limiter-flexible';

import { config } from '@/src/config.js';
import type { Logger } from '@/src/logger.js';

export type TelegramMethod = 'sendMessage' | 'editMessageText';

const TOO_MANY_REQUESTS_ERROR_CODE = 429;
const TELEGRAM_MAX_RATE_LIMIT_RETRIES = 3;

const telegramRateLimiter = new RateLimiterMemory({
  points: config.botRateLimitPerSecond,
  duration: 1,
  keyPrefix: 'telegram-bot-api',
});
const telegramQueue = new RateLimiterQueue(telegramRateLimiter);

const telegramChatRateLimiter = new RateLimiterMemory({
  points: 1,
  duration: 1,
  keyPrefix: 'telegram-chat-api',
});
const telegramChatQueue = new RateLimiterQueue(telegramChatRateLimiter);

async function waitForTelegramRateLimit(
  logger: Logger,
  method: TelegramMethod,
  chatId: number,
): Promise<void> {
  const chatKey = chatId.toString();
  const [globalLimiterRes, chatLimiterRes] = await Promise.all([
    telegramRateLimiter.get('global'),
    telegramChatRateLimiter.get(chatKey),
  ]);
  const globalTokensRemaining = globalLimiterRes?.remainingPoints ?? config.botRateLimitPerSecond;
  const chatTokensRemaining = chatLimiterRes?.remainingPoints ?? 1;

  if (globalTokensRemaining <= 0 || chatTokensRemaining <= 0) {
    logger.debug(
      {
        method,
        chatId,
        globalTokensRemaining,
        chatTokensRemaining,
        limitPerSecond: config.botRateLimitPerSecond,
      },
      'Telegram API rate limit reached, queueing request',
    );
  }

  await telegramQueue.removeTokens(1, 'global');
  await telegramChatQueue.removeTokens(1, chatKey);
}

export async function executeTelegramRequest<T>(
  logger: Logger,
  method: TelegramMethod,
  chatId: number,
  request: () => Promise<T>,
): Promise<T> {
  let rateLimitRetries = 0;

  for (;;) {
    await waitForTelegramRateLimit(logger, method, chatId);

    try {
      return await request();
    } catch (error) {
      const retryAfterMs = getRetryAfterMs(error);
      if (retryAfterMs === null) {
        throw error;
      }

      if (rateLimitRetries >= TELEGRAM_MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }

      rateLimitRetries += 1;
      logger.warn(
        {
          err: error,
          method,
          chatId,
          retryAfterMs,
          retryAttempt: rateLimitRetries,
          maxRetries: TELEGRAM_MAX_RATE_LIMIT_RETRIES,
        },
        'Telegram API returned rate limit, retrying request',
      );
      await delay(retryAfterMs);
    }
  }
}

function getRetryAfterMs(error: unknown): number | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('error_code' in error) ||
    (error as { error_code: number }).error_code !== TOO_MANY_REQUESTS_ERROR_CODE ||
    !('parameters' in error)
  ) {
    return null;
  }

  const retryAfter = (error as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
  if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter <= 0) {
    return null;
  }

  return retryAfter * 1000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
