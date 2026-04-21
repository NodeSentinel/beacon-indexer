type NotificationFormatter = (payload: unknown) => string;

type IncidentPayload = {
  clusterName?: string;
  closedAt?: string;
  closedSlot?: number | null;
  durationSeconds?: number | null;
  durationSlots?: number | null;
  missedConsensusRewards?: string | { token?: string; wei?: string };
  openedAt?: string;
  openedSlot?: number;
  validatorIndexes?: number[];
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

  return [
    'Cluster incident opened',
    `Cluster: ${data.clusterName ?? 'Unknown cluster'}`,
    `Started slot: ${data.openedSlot ?? '-'}`,
    `Started at: ${data.openedAt ?? '-'}`,
    `Affected validators: ${formatValidatorIndexes(data.validatorIndexes)}`,
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
    `Duration: ${formatDuration(data.durationSeconds)} (${data.durationSlots ?? 0} slots)`,
    `Missed rewards: ${formatMissedConsensusRewards(data.missedConsensusRewards)}`,
    `Affected validators: ${formatValidatorIndexes(data.validatorIndexes)}`,
  ].join('\n');
}

/** Converts unknown payloads into the incident payload shape. */
function asIncidentPayload(payload: unknown): IncidentPayload {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as IncidentPayload;
  }

  return {};
}

/** Formats validator indexes without exceeding Telegram's message limit. */
function formatValidatorIndexes(indexes: number[] | undefined): string {
  if (!indexes?.length) return '-';

  const maxValidatorIndexes = 50;
  const visibleIndexes = indexes.slice(0, maxValidatorIndexes).join(', ');
  const hiddenCount = indexes.length - maxValidatorIndexes;

  if (hiddenCount <= 0) return visibleIndexes;

  return `${visibleIndexes} ... and ${hiddenCount} more`;
}

/** Formats missed consensus rewards for Telegram copy. */
function formatMissedConsensusRewards(rewards: IncidentPayload['missedConsensusRewards']): string {
  if (!rewards) return '0';
  if (typeof rewards === 'string') return rewards;

  return rewards.token ?? rewards.wei ?? '0';
}

/** Formats a duration in seconds using compact units. */
function formatDuration(durationSeconds: number | null | undefined): string {
  if (!durationSeconds || durationSeconds <= 0) return '0s';

  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;
  const parts = [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    seconds > 0 ? `${seconds}s` : null,
  ].filter(Boolean);

  return parts.join(' ');
}
