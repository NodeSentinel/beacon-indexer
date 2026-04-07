import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IncidentTrackerStorage } from '../storage/incidentTracker.js';

import { IncidentTrackerController } from './incidentTracker.js';

describe('IncidentTrackerController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates the global inactivity threshold together with the safe slot bound', async () => {
    const processSlotsThrough = vi.fn().mockResolvedValue(undefined);
    const controller = new IncidentTrackerController({
      processSlotsThrough,
    } as unknown as IncidentTrackerStorage);

    await controller.syncTrackedIncidents({
      lastIndexedSlot: 105,
      maxAttestationDelay: 2,
      inactiveMissedCount: 3,
    });

    expect(processSlotsThrough).toHaveBeenCalledWith({
      processor: 'incident-tracker',
      safeUpperBound: 103,
      maxAttestationDelay: 2,
      inactiveMissedCount: 3,
    });
  });
});
