import type { Api, RawApi } from 'grammy';

import { getRpcClientForUser } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';

/** Telegram API error code for "bot was blocked by the user" */
const BLOCKED_ERROR_CODE = 403;

/** Telegram API error description for "message is not modified" (not a real error) */
const SAME_MESSAGE_DESCRIPTION = 'Bad Request: message is not modified';

/** In-memory set of blocked telegramIds (populated on 403, cleared on unblock) */
export const blockedUserIds = new Set<string>();

type SendMessageOptions = Parameters<Api<RawApi>['sendMessage']>[2];

async function sendTelegramMessage(
  api: Api<RawApi>,
  chatId: number,
  telegramId: string,
  text: string,
  logger: Logger,
  options?: SendMessageOptions,
): Promise<number | null> {
  try {
    const result = await api.sendMessage(chatId, text, options);
    return result.message_id;
  } catch (error) {
    if (isBlockedError(error)) {
      await handleBlockedUser(telegramId, logger);
      return null;
    }

    logger.warn({ err: error, chatId }, 'Failed to send Telegram message');
    return null;
  }
}

/**
 * Send a message to a Telegram chat. Detects 403 (blocked) and marks the user via API.
 * Returns the message_id of the sent message.
 */
export async function sendDashboardMessage(
  api: Api<RawApi>,
  chatId: number,
  telegramId: string,
  text: string,
  logger: Logger,
): Promise<number | null> {
  return sendTelegramMessage(api, chatId, telegramId, text, logger, {
    parse_mode: 'MarkdownV2',
    link_preview_options: { is_disabled: true },
    disable_notification: true,
  });
}

/**
 * Send a notification message to a Telegram chat.
 * Returns true when delivery succeeded.
 */
export async function sendNotificationMessage(
  api: Api<RawApi>,
  chatId: number,
  telegramId: string,
  text: string,
  logger: Logger,
): Promise<boolean> {
  const messageId = await sendTelegramMessage(api, chatId, telegramId, text, logger, {
    link_preview_options: { is_disabled: true },
  });

  return messageId !== null;
}

/**
 * Edit an existing dashboard message. Detects 403 (blocked) and "same message" errors.
 * Returns true if the edit succeeded, false otherwise.
 */
export async function editDashboardMessage(
  api: Api<RawApi>,
  chatId: number,
  messageId: number,
  telegramId: string,
  text: string,
  logger: Logger,
): Promise<boolean> {
  try {
    await api.editMessageText(chatId, messageId, text, {
      parse_mode: 'MarkdownV2',
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (error) {
    if (isBlockedError(error)) {
      await handleBlockedUser(telegramId, logger);
      return false;
    }

    if (isSameMessageError(error)) {
      logger.debug({ chatId, messageId }, 'Message content unchanged, skipping');
      return true;
    }

    logger.warn({ err: error, chatId, messageId }, 'Failed to edit dashboard message');
    return false;
  }
}

function isBlockedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error_code' in error &&
    (error as { error_code: number }).error_code === BLOCKED_ERROR_CODE
  );
}

function isSameMessageError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'description' in error &&
    (error as { description: string }).description.startsWith(SAME_MESSAGE_DESCRIPTION)
  );
}

async function handleBlockedUser(telegramId: string, logger: Logger): Promise<void> {
  logger.info({ telegramId }, 'User has blocked the bot, marking as blocked');
  blockedUserIds.add(telegramId);
  try {
    const rpcClient = getRpcClientForUser(telegramId);
    await rpcClient.bot.setBlocked({ telegramId });
  } catch (err) {
    logger.error({ err, telegramId }, 'Failed to mark user as blocked via API');
  }
}
