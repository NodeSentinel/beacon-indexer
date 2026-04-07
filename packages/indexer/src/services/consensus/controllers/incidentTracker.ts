import { IncidentTrackerStorage } from '../storage/incidentTracker.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentTrackerController {
  private readonly logger = createLogger('IncidentTrackerController');

  constructor(private readonly storage: IncidentTrackerStorage) {}

  async syncTrackedIncidents(params: {
    lastIndexedSlot: number;
    maxAttestationDelay: number;
  }): Promise<void> {
    const safeUpperBound = params.lastIndexedSlot - params.maxAttestationDelay;
    if (safeUpperBound < 0) {
      return;
    }

    await this.storage.processSlotsThrough({
      processor: 'incident-tracker',
      safeUpperBound,
      maxAttestationDelay: params.maxAttestationDelay,
    });
    this.logger.info('Synchronized tracked incidents', { safeUpperBound });
  }
}
