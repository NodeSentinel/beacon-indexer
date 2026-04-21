import type { Api, RawApi } from 'grammy';

import { COMMON_REQUESTS_TELEGRAM_ID, getRpcClientForUser } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { formatNotificationMessage } from '@/src/telegram/format-notification.js';
import { sendMessage } from '@/src/telegram/messaging.js';

interface BotNotification {
  id: string;
  incidentNotificationType?: 'incident_opened' | 'incident_closed' | null;
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

  const rpcClient = getRpcClientForUser(COMMON_REQUESTS_TELEGRAM_ID);
  const response = await rpcClient.bot.notifications({ limit: 100 });
  const notifications = response.success ? ((response.data ?? []) as BotNotification[]) : [];

  if (notifications.length === 0) return;

  log.info({ notificationCount: notifications.length }, 'Processing notifications');

  for (const notification of notifications) {
    if (signal.aborted) return;
    if (!notification.telegramId) continue;

    const message = formatNotificationMessage(notification.type, notification.payload);
    const messageId = await sendMessage({
      api,
      chatId: Number(notification.telegramId),
      telegramId: notification.telegramId,
      text: message,
      logger: log.child({ notificationId: notification.id, type: notification.type }),
      options: {
        link_preview_options: { is_disabled: true },
      },
    });

    if (messageId === null) continue;

    await rpcClient.bot.setNotificationDelivered({
      id: notification.id,
      incidentNotificationType: notification.incidentNotificationType,
    });
  }
}
