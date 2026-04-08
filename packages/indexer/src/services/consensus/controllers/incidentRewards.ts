import { IncidentRewardsStorage } from '../storage/incidentRewards.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentRewardsController {
  private readonly logger = createLogger('IncidentRewardsController');

  constructor(private readonly storage: IncidentRewardsStorage) {}

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
