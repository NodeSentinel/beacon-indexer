import { InlineKeyboard } from 'grammy';

import type { Api, RawApi } from 'grammy';

type IncidentNotificationSendOptions = Parameters<Api<RawApi>['sendMessage']>[2];

/** Builds Telegram send options for incident notifications. */
export function buildIncidentNotificationSendOptions(): IncidentNotificationSendOptions {
  const dismissKeyboard = new InlineKeyboard().text('Dismiss', 'remove_message');

  return {
    link_preview_options: { is_disabled: true },
    reply_markup: dismissKeyboard,
  };
}
