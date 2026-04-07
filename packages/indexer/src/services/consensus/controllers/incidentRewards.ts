import { IncidentRewardsStorage } from '../storage/incidentRewards.js';

import createLogger from '@/src/lib/pino.js';

export class IncidentRewardsController {
  private readonly logger = createLogger('IncidentRewardsController');

  constructor(private readonly storage: IncidentRewardsStorage) {}

  async syncOpenIncidentRewards(params: { processThroughSlot: number }): Promise<void> {
    await this.storage.syncOpenIncidentRewards({
      processThroughSlot: params.processThroughSlot,
    });
    this.logger.info('Synchronized incident rewards', {
      processThroughSlot: params.processThroughSlot,
    });
  }
}
