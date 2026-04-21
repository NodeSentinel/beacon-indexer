type IncidentNotificationType = 'incident_opened' | 'incident_closed';

const INCIDENT_NOTIFICATION_PREFIX = 'incident-notification';

/** Builds a synthetic notification id for an incident notification. */
export function getIncidentNotificationId(
  type: IncidentNotificationType,
  incidentId: string,
): string {
  return `${INCIDENT_NOTIFICATION_PREFIX}:${type}:${incidentId}`;
}

/** Parses a synthetic incident notification id. */
export function parseIncidentNotificationId(
  id: string,
): { incidentId: string; type: IncidentNotificationType } | null {
  const [prefix, type, incidentId] = id.split(':');

  if (
    prefix !== INCIDENT_NOTIFICATION_PREFIX ||
    (type !== 'incident_opened' && type !== 'incident_closed') ||
    !incidentId
  ) {
    return null;
  }

  return { incidentId, type };
}

export type { IncidentNotificationType };
