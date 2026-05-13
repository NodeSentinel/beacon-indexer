import type { CommandContext } from 'grammy';

import { formatCommunicationPreviewHeader } from './list-format.js';

import { COMMON_REQUESTS_TELEGRAM_ID, getRpcClientForUser } from '@/src/api/client.js';
import type { Context } from '@/src/bot/context.js';

export { formatCommunicationPreviewHeader };

/**
 * Lists pending communications and previews each message body.
 */
export async function listCommunicationsHandler(ctx: CommandContext<Context>) {
  // Use the generic bot client because this command is not tied to any user context.
  const rpcClient = getRpcClientForUser(COMMON_REQUESTS_TELEGRAM_ID);
  const response = await rpcClient.bot.communications();

  if (!response.success || !response.data) {
    return ctx.reply(response.error?.message ?? 'Failed to list communications.');
  }

  if (response.data.length === 0) {
    return ctx.reply('No pending communications.');
  }

  for (const communication of response.data) {
    await ctx.reply(formatCommunicationPreviewHeader(communication));
    await ctx.reply(communication.message, {
      link_preview_options: { is_disabled: true },
    });
  }
}
