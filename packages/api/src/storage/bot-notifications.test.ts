import { describe, expect, it } from 'vitest';

import { getIncidentNotificationId, parseIncidentNotificationId } from './bot-notification-ids.js';

describe('incident notification ids', () => {
  it('round-trips opened and closed incident notification ids', () => {
    // This incident id represents the database row that backs a synthetic bot notification.
    const incidentId = '00000000-0000-4000-8000-000000000123';

    // This assertion verifies open notification ids keep the incident id recoverable.
    expect(
      parseIncidentNotificationId(getIncidentNotificationId('incident_opened', incidentId)),
    ).toEqual({
      incidentId,
      type: 'incident_opened',
    });

    // This assertion verifies closed notification ids keep the incident id recoverable.
    expect(
      parseIncidentNotificationId(getIncidentNotificationId('incident_closed', incidentId)),
    ).toEqual({
      incidentId,
      type: 'incident_closed',
    });
  });

  it('ignores regular queue notification ids', () => {
    // This assertion keeps regular notification_queue ids on the existing delivery path.
    expect(parseIncidentNotificationId('cm123regular')).toBeNull();
  });
});
