import { Composer } from 'grammy';

import type { Context } from '@/src/bot/context.js';
import { handleUnblockedUser } from '@/src/telegram/blocked-users.js';

/**
 * Any incoming update from a user means Telegram allows bot delivery again.
 */
export const userMiddleware = new Composer<Context>();

userMiddleware.use(async (ctx, next) => {
  const telegramId = ctx.from?.id?.toString();
  if (telegramId) {
    await handleUnblockedUser(telegramId, ctx.logger);
  }

  await next();
});
