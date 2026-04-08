import { IncidentTrackerStorage } from '../storage/incidentTracker.js';
import type { SlotStorage } from '../storage/slot.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentTrackerController {
  private readonly logger = createLogger('IncidentTrackerController');

  constructor(
    private readonly storage: IncidentTrackerStorage,
    private readonly slotStorage: SlotStorage,
  ) {}

  async runSync(params: {
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Wait until the slot pipeline has produced a durable cursor before trying
    // to open or close incidents from committee outcomes.
    const lastIndexedSlot = await this.slotStorage.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Reuse the controller's incident-sync logic once a safe cursor exists.
    await this.syncTrackedIncidents({
      lastIndexedSlot,
      maxAttestationDelay: params.maxAttestationDelay,
      inactiveMissedCount: params.inactiveMissedCount,
    });
  }

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
