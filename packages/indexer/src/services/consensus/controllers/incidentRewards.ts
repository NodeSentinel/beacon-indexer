import { IncidentRewardsStorage } from '../storage/incidentRewards.js';
import type { SlotStorage } from '../storage/slot.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentRewardsController {
  private readonly logger = createLogger('IncidentRewardsController');

  constructor(
    private readonly storage: IncidentRewardsStorage,
    private readonly slotStorage: SlotStorage,
  ) {}

  async runSync(): Promise<void> {
    // Rewards can only advance through slots that the slot pipeline has already
    // indexed into the reward tables.
    const lastIndexedSlot = await this.slotStorage.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Delegate the actual reward reconciliation once the upper bound is known.
    await this.syncOpenIncidentRewards({
      processThroughSlot: lastIndexedSlot,
    });
  }

  async syncOpenIncidentRewards(params: { processThroughSlot: number }): Promise<void> {
    // Rewards are synced independently from open/close detection so incidents can
    // advance on the duty timeline first and finalize their missed rewards later.
    await this.storage.syncOpenIncidentRewards({
      processThroughSlot: params.processThroughSlot,
    });
    this.logger.info('Synchronized incident rewards', {
      processThroughSlot: params.processThroughSlot,
    });
  }
}
