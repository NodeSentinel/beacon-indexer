export function formatNotificationMessage(type: string, payload: unknown): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof (payload as { message: unknown }).message === 'string'
  ) {
    return (payload as { message: string }).message;
  }

  return `Notification: ${type}`;
}
