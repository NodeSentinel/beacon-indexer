import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import type { SlotStorage } from '../storage/slot.js';
import { ValidatorActivityStatusStorage } from '../storage/validatorActivityStatus.js';

import createLogger from '@/src/lib/pino.js';

export class ValidatorActivityStatusController {
  private readonly logger = createLogger('ValidatorActivityStatusController');

  constructor(
    private readonly storage: ValidatorActivityStatusStorage,
    private readonly slotStorage: SlotStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async runSync(params: {
    skipValidatorStatusUpdateWhenBehindHeadSlots: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Skip the refresh entirely until the slot pipeline has indexed at least one
    // committee window that can be evaluated safely.
    const lastIndexedSlot = await this.slotStorage.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Reuse the controller's freshness and safe-slot rules once the cursor exists.
    await this.syncCurrentActivityStatus({
      lastIndexedSlot,
      skipValidatorStatusUpdateWhenBehindHeadSlots:
        params.skipValidatorStatusUpdateWhenBehindHeadSlots,
      maxAttestationDelay: params.maxAttestationDelay,
      inactiveMissedCount: params.inactiveMissedCount,
    });
  }

  async syncCurrentActivityStatus(params: {
    lastIndexedSlot: number;
    skipValidatorStatusUpdateWhenBehindHeadSlots: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Compare the live head slot with the last fully indexed slot before trusting
    // committee data for activity updates. When the indexer is too far behind,
    // the safest behavior is to leave the existing snapshot state unchanged.
    const headSlot = this.beaconTime.getChainCurrentSlot();

    if (headSlot - params.lastIndexedSlot > params.skipValidatorStatusUpdateWhenBehindHeadSlots) {
      this.logger.warn(
        'Skipping validator activity status sync because indexed committee data is stale',
        {
          headSlot,
          lastIndexedSlot: params.lastIndexedSlot,
          skipValidatorStatusUpdateWhenBehindHeadSlots:
            params.skipValidatorStatusUpdateWhenBehindHeadSlots,
        },
      );
      return;
    }

    // Ignore the most recent duties until they are old enough to exceed the
    // attestation inclusion delay, so we do not classify "not yet included"
    // attestations as missed.
    const safeObservedSlot = params.lastIndexedSlot - params.maxAttestationDelay;
    if (safeObservedSlot < 0) {
      return;
    }

    // Delegate the actual snapshot update to storage once the observed window is
    // both fresh enough and old enough to judge safely.
    await this.storage.syncCurrentActivityStatus({
      safeObservedSlot,
      inactiveMissedCount: params.inactiveMissedCount,
      maxAttestationDelay: params.maxAttestationDelay,
    });
    this.logger.info('Synchronized current validator activity status', { safeObservedSlot });
  }
}
