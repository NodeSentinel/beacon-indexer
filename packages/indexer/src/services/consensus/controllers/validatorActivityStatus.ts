import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { ValidatorActivityStatusStorage } from '../storage/validatorActivityStatus.js';

import createLogger from '@/src/lib/pino.js';

export class ValidatorActivityStatusController {
  private readonly logger = createLogger('ValidatorActivityStatusController');

  constructor(
    private readonly storage: ValidatorActivityStatusStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async syncCurrentActivityStatus(params: {
    lastIndexedSlot: number;
    maxIndexerLagSlotsForAlerts: number;
    maxAttestationDelay: number;
  }): Promise<void> {
    const headSlot = this.beaconTime.getChainCurrentSlot();

    if (headSlot - params.lastIndexedSlot > params.maxIndexerLagSlotsForAlerts) {
      this.logger.warn(
        'Skipping validator activity status sync because indexed committee data is stale',
        {
          headSlot,
          lastIndexedSlot: params.lastIndexedSlot,
          maxIndexerLagSlotsForAlerts: params.maxIndexerLagSlotsForAlerts,
        },
      );
      return;
    }

    const safeObservedSlot = params.lastIndexedSlot - params.maxAttestationDelay;
    if (safeObservedSlot < 0) {
      return;
    }

    await this.storage.syncCurrentActivityStatus({
      safeObservedSlot,
      maxAttestationDelay: params.maxAttestationDelay,
    });
    this.logger.info('Synchronized current validator activity status', { safeObservedSlot });
  }
}
