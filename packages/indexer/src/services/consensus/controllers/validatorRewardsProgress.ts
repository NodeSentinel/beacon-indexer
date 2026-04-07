import { ValidatorRewardsProgressStorage } from '../storage/validatorRewardsProgress.js';

import createLogger from '@/src/lib/pino.js';

export class ValidatorRewardsProgressController {
  private readonly logger = createLogger('ValidatorRewardsProgressController');

  constructor(private readonly storage: ValidatorRewardsProgressStorage) {}

  async syncValidatorRewardsProgress(params: { processThroughSlot: number }): Promise<void> {
    await this.storage.syncValidatorRewardsProgress({
      processThroughSlot: params.processThroughSlot,
    });
    this.logger.info('Synchronized validator rewards progress', {
      processThroughSlot: params.processThroughSlot,
    });
  }
}
