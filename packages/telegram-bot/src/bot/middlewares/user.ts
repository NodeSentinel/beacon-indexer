import { Composer } from 'grammy';

import { getRpcClientForUser } from '@/src/api/client.js';
import type { Context } from '@/src/bot/context.js';
import { blockedUserIds } from '@/src/telegram/messaging.js';

/**
 * Middleware that detects previously-blocked users who re-engage with the bot.
 * When a user whose telegramId is in the blockedUserIds set sends any message,
 * this middleware calls the API to mark them as unblocked and removes them from the set.
 */
export const userMiddleware = new Composer<Context>();

userMiddleware.use(async (ctx, next) => {
  const telegramId = ctx.from?.id?.toString();
  if (telegramId && blockedUserIds.has(telegramId)) {
    ctx.logger.info({ telegramId }, 'Previously blocked user re-engaged, unblocking');
    blockedUserIds.delete(telegramId);
    try {
      const rpcClient = getRpcClientForUser(telegramId);
      await rpcClient.bot.setUnblocked({ telegramId });
    } catch (err) {
      ctx.logger.error({ err, telegramId }, 'Failed to unblock user via API');
    }
  }
  await next();
});
