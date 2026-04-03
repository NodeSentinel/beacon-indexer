import type { Logger } from '@/src/logger.js';
import { handleBlockedUser } from '@/src/telegram/blocked-users.js';
import { executeTelegramRequest, type TelegramMethod } from '@/src/telegram/rate-limit.js';
import { isBlockedError, isSameMessageError } from '@/src/telegram/telegram-errors.js';

type LogContext = Record<string, unknown>;

type TelegramRequestResult<TResponse> =
  | { ok: true; response: TResponse }
  | { ok: false; sameMessage: boolean };

interface TelegramRequestOptions<TResponse> {
  logger: Logger;
  method: TelegramMethod;
  chatId: number;
  telegramId: string;
  request: () => Promise<TResponse>;
  logContext?: LogContext;
  treatSameMessageAsSuccess?: boolean;
}

const FAILURE_MESSAGES: Record<TelegramMethod, string> = {
  sendMessage: 'Failed to send Telegram message',
  editMessageText: 'Failed to edit Telegram message',
};

export async function handleTelegramRequest<TResponse>({
  logger,
  method,
  chatId,
  telegramId,
  request,
  logContext = {},
  treatSameMessageAsSuccess = false,
}: TelegramRequestOptions<TResponse>): Promise<TelegramRequestResult<TResponse>> {
  try {
    return { ok: true, response: await executeTelegramRequest(logger, method, chatId, request) };
  } catch (error) {
    if (isBlockedError(error)) {
      await handleBlockedUser(telegramId, logger);
      return { ok: false, sameMessage: false };
    }

    if (treatSameMessageAsSuccess && isSameMessageError(error)) {
      logger.debug({ chatId, ...logContext }, 'Message content unchanged, skipping');
      return { ok: false, sameMessage: true };
    }

    logger.warn({ err: error, chatId, ...logContext }, FAILURE_MESSAGES[method]);
    return { ok: false, sameMessage: false };
  }
}
