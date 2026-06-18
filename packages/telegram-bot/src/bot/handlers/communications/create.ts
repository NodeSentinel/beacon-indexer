import type { CommandContext } from 'grammy';

import { parseCreateCommunicationCommand } from './create-parser.js';

import { COMMON_REQUESTS_TELEGRAM_ID, getRpcClientForUser } from '@/src/api/client.js';
import type { Context } from '@/src/bot/context.js';

const CREATE_COMMUNICATION_USAGE = 'Usage: /create_communication <description> >> <message>';

/**
 * Creates a pending communication and returns its id to the admin.
 */
export async function createCommunicationHandler(ctx: CommandContext<Context>) {
  const parsed = parseCreateCommunicationCommand(ctx.message?.text);

  if (!parsed) {
    return ctx.reply(CREATE_COMMUNICATION_USAGE);
  }

  // Use the generic bot client because this command is not tied to any user context.
  const rpcClient = getRpcClientForUser(COMMON_REQUESTS_TELEGRAM_ID);
  const response = await rpcClient.bot.createCommunication({
    description: parsed.description,
    message: parsed.message,
    exclude: [],
    onlyTo: [],
  });

  if (!response.success || !response.data) {
    return ctx.reply(response.error?.message ?? 'Failed to create communication.');
  }

  return ctx.reply(`Communication created: ${response.data.id}`);
}
