import type { Api, RawApi } from 'grammy';

import { COMMON_REQUESTS_TELEGRAM_ID, getRpcClientForUser } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { formatNotificationMessage } from '@/src/telegram/format-notification.js';
import { buildIncidentNotificationSendOptions } from '@/src/telegram/incident-notification-options.js';
import { sendMessage } from '@/src/telegram/messaging.js';

type IncidentNotificationType = 'incident_opened' | 'incident_closed';

interface BotIncidentNotification {
  id: string;
  userId: string;
  telegramId: string;
  type: IncidentNotificationType;
  payload: unknown;
  createdAt: string;
}

/** Processes incident notifications without using the notification queue. */
export async function processIncidentNotifications(
  api: Api<RawApi>,
  signal: AbortSignal,
  log: Logger,
): Promise<void> {
  if (signal.aborted) return;

  const rpcClient = getRpcClientForUser(COMMON_REQUESTS_TELEGRAM_ID);
  const response = await rpcClient.bot.incidentNotifications({ limit: 100 });
  const notifications = response.success
    ? ((response.data ?? []) as BotIncidentNotification[])
    : [];

  if (notifications.length === 0) return;

  log.info({ notificationCount: notifications.length }, 'Processing incident notifications');

  for (const notification of notifications) {
    if (signal.aborted) return;

    const message = formatNotificationMessage(notification.type, notification.payload);
    const messageId = await sendMessage({
      api,
      chatId: Number(notification.telegramId),
      telegramId: notification.telegramId,
      text: message,
      logger: log.child({ incidentId: notification.id, type: notification.type }),
      options: buildIncidentNotificationSendOptions(),
    });

    if (messageId === null) continue;

    if (notification.type === 'incident_opened') {
      await rpcClient.bot.setIncidentOpenedNotified({ incidentId: notification.id });
      continue;
    }

    await rpcClient.bot.setIncidentClosedNotified({ incidentId: notification.id });
  }
}
