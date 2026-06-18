import type { SlotStorage } from '../storage/slot.js';
import { ValidatorActivityStatusStorage } from '../storage/validatorActivityStatus.js';

import createLogger from '@/src/lib/pino.js';

export class ValidatorActivityStatusController {
  private readonly logger = createLogger('ValidatorActivityStatusController');

  constructor(
    private readonly storage: ValidatorActivityStatusStorage,
    private readonly slotStorage: SlotStorage,
  ) {}

  async syncCurrentActivityStatus(params: {
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    // Skip the refresh until the slot pipeline has completed at least one slot.
    const lastProcessedSlot = await this.slotStorage.getLastProcessedSlot();
    if (lastProcessedSlot === null) {
      return;
    }

    // Evaluate only duties whose attestation inclusion window has fully elapsed.
    const newestEvaluableDutySlot = lastProcessedSlot - params.maxAttestationDelay;
    if (newestEvaluableDutySlot < 0) {
      return;
    }

    // Replay activity state through the newest duty slot that can be judged.
    await this.storage.syncCurrentActivityStatus({
      newestEvaluableDutySlot,
      inactiveMissedCount: params.inactiveMissedCount,
      maxAttestationDelay: params.maxAttestationDelay,
    });
    this.logger.info('Synchronized current validator activity status', {
      newestEvaluableDutySlot,
    });
  }
}
