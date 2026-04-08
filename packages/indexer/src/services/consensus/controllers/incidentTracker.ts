import { IncidentTrackerStorage } from '../storage/incidentTracker.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentTrackerController {
  private readonly logger = createLogger('IncidentTrackerController');

  constructor(private readonly storage: IncidentTrackerStorage) {}

  async syncTrackedIncidents(params: {
    lastIndexedSlot: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Reuse the same "safe slot" rule as activity status so the tracker only
    // opens or closes incidents from duties whose inclusion outcome is final.
    const safeUpperBound = params.lastIndexedSlot - params.maxAttestationDelay;
    if (safeUpperBound < 0) {
      return;
    }

    // Advance the durable incident processor cursor through the confirmed slot
    // range and let storage handle the cluster/validator transitions.
    await this.storage.processSlotsThrough({
      processor: 'incident-tracker',
      safeUpperBound,
      maxAttestationDelay: params.maxAttestationDelay,
      inactiveMissedCount: params.inactiveMissedCount,
    });
    this.logger.info('Synchronized tracked incidents', { safeUpperBound });
  }
}
