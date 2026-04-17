import type { Api, RawApi } from 'grammy';

import { getRpcClientForUser } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { notifyUserStats } from '@/src/scheduler/notify-user-stats.js';

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

export async function processUsers(
  api: Api<RawApi>,
  signal: AbortSignal,
  log: Logger,
): Promise<void> {
  const rpcClient = getRpcClientForUser('0');
  const response = await rpcClient.bot.users({});
  const users = response.success ? (response.data ?? []) : [];

  log.info({ userCount: users.length }, 'Processing users');

  for (const user of users) {
    if (signal.aborted) return;
    try {
      await notifyUserStats(api, user, log);
    } catch (err) {
      log.error({ err, telegramId: user.telegramId }, 'Error notifying user');
    }
    await delay(10_000, signal);
  }
}
