type NotificationFormatter = (payload: unknown) => string;

type IncidentPayload = {
  clusterName?: string;
  closedAt?: string;
  closedSlot?: number;
  durationSeconds?: number;
  durationSlots?: number;
  missedAttestations?: number;
  missedConsensusRewards?: string;
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

function formatIncidentOpened(payload: unknown): string {
  const data = asIncidentPayload(payload);
  const validators = formatValidatorIndexes(data.validatorIndexes);

  return [
    'Cluster incident opened',
    `Cluster: ${data.clusterName ?? 'Unknown cluster'}`,
    `Started slot: ${data.openedSlot ?? '-'}`,
    `Started at: ${data.openedAt ?? '-'}`,
    `Affected validators: ${validators}`,
  ].join('\n');
}

function formatIncidentClosed(payload: unknown): string {
  const data = asIncidentPayload(payload);
  const validators = formatValidatorIndexes(data.validatorIndexes);

  return [
    'Cluster incident resolved',
    `Cluster: ${data.clusterName ?? 'Unknown cluster'}`,
    `Closed slot: ${data.closedSlot ?? '-'}`,
    `Closed at: ${data.closedAt ?? '-'}`,
    `Duration: ${formatDuration(data.durationSeconds)} (${data.durationSlots ?? 0} slots)`,
    `Missed attestations: ${data.missedAttestations ?? 0}`,
    `Missed rewards: ${data.missedConsensusRewards ?? '0'}`,
    `Affected validators: ${validators}`,
  ].join('\n');
}

function asIncidentPayload(payload: unknown): IncidentPayload {
  if (typeof payload === 'object' && payload !== null) {
    return payload as IncidentPayload;
  }

  return {};
}

function formatValidatorIndexes(indexes: number[] | undefined): string {
  if (!indexes?.length) return '-';
  return indexes.join(', ');
}

function formatDuration(durationSeconds: number | undefined): string {
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
