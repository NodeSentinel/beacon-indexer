import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { ChainStatsStorage } from '../storage/chainStats.js';

export class ChainStatsController {
  constructor(
    private readonly storage: ChainStatsStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async computeStats(epoch: number): Promise<{ epoch: number; skipped: boolean }> {
    const lastProcessed = await this.storage.getLastProcessedEpoch();
    if (lastProcessed !== null && lastProcessed >= epoch) {
      return { epoch, skipped: true };
    }

    const { startSlot, endSlot } = this.beaconTime.getEpochSlots(epoch);

    await this.storage.insertChainEpochStats(
      epoch,
      [
        VALIDATOR_STATUS.active_ongoing,
        VALIDATOR_STATUS.active_exiting,
        VALIDATOR_STATUS.active_slashed,
      ],
      [VALIDATOR_STATUS.pending_initialized, VALIDATOR_STATUS.pending_queued],
      VALIDATOR_STATUS.active_exiting,
      startSlot,
      endSlot,
    );

    return { epoch, skipped: false };
  }
}
