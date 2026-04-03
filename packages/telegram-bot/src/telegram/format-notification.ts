type NotificationFormatter = (payload: unknown) => string;

const notificationFormatters: Record<string, NotificationFormatter> = {};

export function formatNotificationMessage(type: string, payload: unknown): string {
  const formatter = notificationFormatters[type];
  if (formatter) return formatter(payload);

  return formatNotificationPayload(payload);
}

function formatNotificationPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;

  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof (payload as { message: unknown }).message === 'string'
  ) {
    return (payload as { message: string }).message;
  }

  if (payload === null || payload === undefined) return '';

  return JSON.stringify(payload, null, 2);
}
