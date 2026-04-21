import type { Api, RawApi } from 'grammy';

import type { Logger } from '@/src/logger.js';
import { handleTelegramRequest } from '@/src/telegram/request.js';

type SendMessageOptions = Parameters<Api<RawApi>['sendMessage']>[2];
type EditMessageTextOptions = Parameters<Api<RawApi>['editMessageText']>[3];

interface SendMessageBaseParams {
  api: Api<RawApi>;
  chatId: number;
  telegramId: string;
  text: string;
  logger: Logger;
  options?: SendMessageOptions;
}

interface EditMessageParams {
  api: Api<RawApi>;
  chatId: number;
  messageId: number;
  telegramId: string;
  text: string;
  logger: Logger;
  options?: EditMessageTextOptions;
}

export async function sendMessage({
  api,
  chatId,
  telegramId,
  text,
  logger,
  options,
}: SendMessageBaseParams): Promise<number | null> {
  const result = await handleTelegramRequest({
    logger,
    method: 'sendMessage',
    chatId,
    telegramId,
    request: () => api.sendMessage(chatId, text, options),
  });

  return result.ok ? result.response.message_id : null;
}

export async function editMessage({
  api,
  chatId,
  messageId,
  telegramId,
  text,
  logger,
  options,
}: EditMessageParams): Promise<boolean> {
  const result = await handleTelegramRequest({
    logger,
    method: 'editMessageText',
    chatId,
    telegramId,
    request: () => api.editMessageText(chatId, messageId, text, options),
    logContext: { messageId },
    treatSameMessageAsSuccess: true,
  });

  return result.ok || result.sameMessage;
}
