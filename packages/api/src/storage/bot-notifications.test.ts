import { describe, expect, it } from 'vitest';

import { getIncidentDeliveryTarget } from './bot-notifications.js';

describe('incident notification delivery targets', () => {
  it('uses explicit incident metadata instead of synthetic notification ids', () => {
    // This incident id represents the database row that backs a synthetic bot notification.
    const incidentId = '00000000-0000-4000-8000-000000000123';

    // This assertion verifies open notification metadata keeps the real incident id.
    expect(getIncidentDeliveryTarget(incidentId, 'incident_opened')).toEqual({
      incidentId,
      type: 'incident_opened',
    });

    // This assertion verifies closed notification metadata keeps the real incident id.
    expect(getIncidentDeliveryTarget(incidentId, 'incident_closed')).toEqual({
      incidentId,
      type: 'incident_closed',
    });
  });
});
