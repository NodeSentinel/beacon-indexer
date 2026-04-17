import { InlineKeyboard } from 'grammy';
import type { CommandContext } from 'grammy';

import { getRpcClientForUser } from '@/src/api/client.js';
import type { Context } from '@/src/bot/context.js';
import { sendNotificationMessage } from '@/src/telegram/messaging.js';

/**
 * Parses the communication id from the /send_communication command text.
 */
function parseCommunicationId(text: string | undefined): number | null {
  if (!text) return null;

  const [, rawId] = text.trim().split(/\s+/, 2);
  if (!rawId) return null;

  const communicationId = Number.parseInt(rawId, 10);

  return Number.isSafeInteger(communicationId) && communicationId > 0 ? communicationId : null;
}

/**
 * Sends one stored communication to its resolved audience.
 */
export async function sendCommunicationHandler(ctx: CommandContext<Context>) {
  const communicationId = parseCommunicationId(ctx.message?.text);

  if (!communicationId) {
    return ctx.reply('Usage: /send_communication <id>');
  }

  // Stop early when Telegram did not attach the sender metadata.
  if (!ctx.from) {
    return ctx.reply('Unable to identify the sender of this command.');
  }

  const telegramId = ctx.from.id.toString();
  const rpcClient = getRpcClientForUser(telegramId);
  const communicationResponse = await rpcClient.bot.getCommunication({
    id: communicationId,
  });

  if (!communicationResponse.success || !communicationResponse.data) {
    return ctx.reply(
      communicationResponse.error?.message ?? `Communication ${communicationId} was not found.`,
    );
  }

  if (communicationResponse.data.sent) {
    return ctx.reply('already sent');
  }

  // Reuse the legacy dismiss button so every user can remove the broadcast locally.
  const dismissKeyboard = new InlineKeyboard().text('Dismiss', 'remove_message');

  let sentCount = 0;
  let failedCount = 0;

  // Send the message sequentially so the bot logs remain easy to trace during manual broadcasts.
  for (const recipient of communicationResponse.data.recipients) {
    const delivered = await sendNotificationMessage(
      ctx.api,
      Number(recipient.telegramId),
      recipient.telegramId,
      communicationResponse.data.message,
      ctx.logger,
      {
        reply_markup: dismissKeyboard,
      },
    );

    if (delivered) sentCount += 1;
    else failedCount += 1;
  }

  const markSentResponse = await rpcClient.bot.markCommunicationSent({
    id: communicationId,
  });

  if (!markSentResponse.success) {
    return ctx.reply(markSentResponse.error?.message ?? 'already sent');
  }

  return ctx.reply(
    `Communication ${communicationId} sent to ${sentCount} users. Failed deliveries: ${failedCount}.`,
  );
}
