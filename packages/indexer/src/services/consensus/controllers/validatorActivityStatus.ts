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
    // Reads the current chain head to avoid judging slots too close to it.
    const headSlot = this.beaconTime.getChainCurrentSlot();

    // Keeps a small gap from head so the node has time to expose fresh data.
    const lastSlotSafeToReadFromNode =
      headSlot - params.skipValidatorStatusUpdateWhenBehindHeadSlots;

    // Uses the smaller limit between what we already indexed and what is safe
    // to read from the node.
    const lastIndexedSlotSafeToUse = Math.min(params.lastIndexedSlot, lastSlotSafeToReadFromNode);

    // Gets the newest slot we can process in this iteration.
    const newestProcessableSlot = lastIndexedSlotSafeToUse - params.maxAttestationDelay;
    if (newestProcessableSlot < 0) {
      return;
    }

    // Replays the snapshot only up to the newest safe slot.
    await this.storage.syncCurrentActivityStatus({
      newestProcessableSlot,
      inactiveMissedCount: params.inactiveMissedCount,
      maxAttestationDelay: params.maxAttestationDelay,
    });
    this.logger.info('Synchronized current validator activity status', {
      newestProcessableSlot,
    });
  }
}
