import { Composer } from 'grammy';

import type { Context } from '@/src/bot/context.js';

import { getRpcClientForUser } from '@/src/api/client.js';
import { logHandle } from '@/src/bot/helpers/logging.js';

const composer = new Composer<Context>();

const feature = composer.chatType('private');

feature.command('dashboard', logHandle('command-dashboard'), async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    const rpcClient = getRpcClientForUser(telegramId);
    await rpcClient.bot.updateMessageId({ telegramId, messageId: 0 });
    return ctx.reply('Dashboard message reset. A new one will be sent shortly.');
  } catch (error) {
    ctx.logger.error({ err: error }, 'Failed to reset message');
    return ctx.reply('Failed to reset dashboard message. Try again later.');
  }
});

export { composer as dashboardFeature };
