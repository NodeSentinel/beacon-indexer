import type { Api, RawApi } from 'grammy';

import { orpcClient, setCurrentTelegramId } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { notifyUserStats } from '@/src/scheduler/notify-user-stats.js';

/** Interval between scheduler ticks */
const TICK_INTERVAL_MS = 1_000;

/** Delay before retrying when the user list fetch fails */
const ERROR_BACKOFF_MS = 10_000;

/**
 * Start the scheduler that periodically notifies users.
 * Returns a cleanup function that stops the scheduler.
 */
export function startScheduler(api: Api<RawApi>, logger: Logger): () => void {
  const schedulerLogger = logger.child({ module: 'scheduler' });
  schedulerLogger.info('Scheduler started');

  let running = false;
  const backoffTimer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (running) return; // skip if previous tick is still running
    running = true;

    try {
      setCurrentTelegramId('0');
      const response = await orpcClient.bot.users({});

      if (!response.success || !response.data?.length) {
        schedulerLogger.debug('No notifiable users found');
        return;
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
    } finally {
      running = false;
    }
  }

  // Run immediately, then on interval
  void tick();
  const interval = setInterval(tick, TICK_INTERVAL_MS);

  // Return cleanup function
  return () => {
    schedulerLogger.info('Scheduler stopped');
    clearInterval(interval);
    if (backoffTimer) clearTimeout(backoffTimer);
  };
}
