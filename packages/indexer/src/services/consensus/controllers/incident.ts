import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { IncidentStorage } from '../storage/incident.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentController {
  private readonly logger = createLogger('IncidentController');

  constructor(
    private readonly incidentStorage: IncidentStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async syncOpenIncidents(maxAttestationDelay: number): Promise<void> {
    const observedSlot = Math.max(0, this.beaconTime.getChainCurrentSlot() - maxAttestationDelay);
    const observedAt = new Date(this.beaconTime.getTimestampFromSlotNumber(observedSlot));

    await this.incidentStorage.syncIncidents({
      observedAt,
      observedAtIso: observedAt.toISOString(),
      observedSlot,
    });
    this.logger.info('Synchronized cluster incidents');
  }
}
