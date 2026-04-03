import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { IncidentStorage } from '../storage/incident.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentController {
  private readonly logger = createLogger('IncidentController');

  constructor(
    private readonly incidentStorage: IncidentStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async syncOpenIncidents(maxAttestationDelay: number): Promise<{
    opened: number;
    updated: number;
    closed: number;
  }> {
    const observedSlot = Math.max(0, this.beaconTime.getChainCurrentSlot() - maxAttestationDelay);
    const observedAt = new Date(this.beaconTime.getTimestampFromSlotNumber(observedSlot));

    const result = await this.incidentStorage.syncIncidents({
      observedAt,
      observedAtIso: observedAt.toISOString(),
      observedSlot,
    });

    if (result.opened || result.updated || result.closed) {
      this.logger.info('Synchronized cluster incidents', result);
    }

    return result;
  }
}
