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
    // Incident ownership moved into validator-activity processing, so the old
    // replay controller now remains intentionally idle.
    void params;
    void this.storage;
    void this.slotStorage;
    this.logger.debug('Skipping incident tracker sync because activity processing owns incidents');
  }

  async syncTrackedIncidents(params: {
    lastIndexedSlot: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Keep the public API harmless for tests and callers that still invoke it
    // while the replay-based tracker is being retired.
    void params;
    this.logger.debug('Ignoring incident tracker sync because activity processing owns incidents');
  }
}
