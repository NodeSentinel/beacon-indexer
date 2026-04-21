import { formatDistanceStrict, parseISO } from 'date-fns';

type NotificationFormatter = (payload: unknown) => string;

type IncidentPayload = {
  clusterName?: string;
  closedAt?: string;
  closedSlot?: number | null;
  isReminder?: boolean;
  now?: string;
  openedAt?: string;
  openedSlot?: number;
};

const notificationFormatters: Record<string, NotificationFormatter> = {
  incident_opened: (payload) => formatIncidentOpened(payload),
  incident_closed: (payload) => formatIncidentClosed(payload),
};

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

/** Formats an incident opened notification. */
function formatIncidentOpened(payload: unknown): string {
  const data = asIncidentPayload(payload);

  if (data.isReminder) {
    return `There is an incident for cluster ${data.clusterName ?? 'Unknown cluster'}, it has been opened for ${formatOpenDuration(data)}.`;
  }

  return [
    'Cluster incident opened',
    `Cluster: ${data.clusterName ?? 'Unknown cluster'}`,
    `Started slot: ${data.openedSlot ?? '-'}`,
    `Started at: ${data.openedAt ?? '-'}`,
  ].join('\n');
}

/** Formats an incident closed notification. */
function formatIncidentClosed(payload: unknown): string {
  const data = asIncidentPayload(payload);

  return [
    'Cluster incident resolved',
    `Cluster: ${data.clusterName ?? 'Unknown cluster'}`,
    `Closed slot: ${data.closedSlot ?? '-'}`,
    `Closed at: ${data.closedAt ?? '-'}`,
  ].join('\n');
}

/** Converts unknown payloads into the incident payload shape. */
function asIncidentPayload(payload: unknown): IncidentPayload {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as IncidentPayload;
  }

  return {};
}

/** Formats how long an open incident has been running. */
function formatOpenDuration(data: IncidentPayload): string {
  if (!data.openedAt) return '0 seconds';

  const openedAt = parseISO(data.openedAt);
  const now = data.now ? parseISO(data.now) : new Date();

  return formatDistanceStrict(now, openedAt, {
    roundingMethod: 'floor',
  });
}
