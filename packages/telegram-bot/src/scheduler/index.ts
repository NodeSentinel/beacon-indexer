import type { Api, RawApi } from 'grammy';

import { orpcClient, setCurrentTelegramId } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { notifyUserStats } from '@/src/scheduler/notify-user-stats.js';

/** Delay before retrying when the user list fetch fails */
const ERROR_BACKOFF_MS = 10_000;

/**
 * Start the infinite scheduler loop.
 * Fetches all notifiable users, iterates them sequentially,
 * then starts over. Never returns unless the process is killed.
 */
export async function startScheduler(api: Api<RawApi>, logger: Logger): Promise<never> {
  const schedulerLogger = logger.child({ module: 'scheduler' });
  schedulerLogger.info('Scheduler started');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Use a dummy telegramId for the bot-users list endpoint.
      // The bot-signature auth requires a telegramId in the header,
      // but the /bot/users endpoint doesn't use context.user.
      // We use "0" as a sentinel value.
      setCurrentTelegramId('0');
      const response = await orpcClient.bot.users({});

      if (!response.success || !response.data?.length) {
        schedulerLogger.debug('No notifiable users found, waiting before retry');
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }

      schedulerLogger.info({ userCount: response.data.length }, 'Processing users');

      for (const user of response.data) {
        try {
          await notifyUserStats(api, user, schedulerLogger);
        } catch (error) {
          schedulerLogger.error(
            { err: error, telegramId: user.telegramId, username: user.username },
            'Error notifying user',
          );
        }
      }
    } catch (error) {
      schedulerLogger.error({ err: error }, 'Error fetching user list, backing off');
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
