import type { Api, RawApi } from 'grammy';

import { orpcClient, setCurrentTelegramId } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { formatNotificationMessage } from '@/src/telegram/format-notification.js';
import { sendNotificationMessage } from '@/src/telegram/messaging.js';

interface BotNotification {
  id: string;
  userId: string;
  telegramId: string | null;
  type: string;
  payload: unknown;
  createdAt: string;
}

export async function processNotifications(
  api: Api<RawApi>,
  signal: AbortSignal,
  log: Logger,
): Promise<void> {
  if (signal.aborted) return;

  setCurrentTelegramId('0');
  const response = await orpcClient.bot.notifications({ limit: 100 });
  const notifications = response.success ? ((response.data ?? []) as BotNotification[]) : [];

  if (notifications.length === 0) return;

  log.info({ notificationCount: notifications.length }, 'Processing notifications');

  for (const notification of notifications) {
    if (signal.aborted) return;
    if (!notification.telegramId) continue;

    const message = formatNotificationMessage(notification.type, notification.payload);
    const delivered = await sendNotificationMessage(
      api,
      Number(notification.telegramId),
      notification.telegramId,
      message,
      log.child({ notificationId: notification.id, type: notification.type }),
    );

    if (!delivered) continue;

    await orpcClient.bot.setNotificationDelivered({ id: notification.id });
  }
}
