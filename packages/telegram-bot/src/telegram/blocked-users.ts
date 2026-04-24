import type { Logger } from '@/src/logger.js';

import { getRpcClientForUser } from '@/src/api/client.js';

export async function handleBlockedUser(telegramId: string, logger: Logger): Promise<void> {
  logger.info({ telegramId }, 'User has blocked the bot, marking as blocked');
  try {
    const rpcClient = getRpcClientForUser(telegramId);
    await rpcClient.bot.setBlocked({ telegramId });
  } catch (err) {
    logger.error({ err, telegramId }, 'Failed to mark user as blocked via API');
  }
}

export async function handleUnblockedUser(telegramId: string, logger: Logger): Promise<void> {
  try {
    const rpcClient = getRpcClientForUser(telegramId);
    await rpcClient.bot.setUnblocked({ telegramId });
  } catch (err) {
    logger.error({ err, telegramId }, 'Failed to mark user as unblocked via API');
  }
}
