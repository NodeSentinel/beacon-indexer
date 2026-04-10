import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { IncidentRewardsStorage } from '../storage/incidentRewards.js';
import type { SlotStorage } from '../storage/slot.js';

import createLogger from '@/src/lib/pino.js';

type SyncOpenIncidentRewardsParams = {
  // Furthest durable slot whose missed rewards should be folded into open or
  // newly closed incidents during this controller pass.
  processThroughSlot: number;
};

export class IncidentRewardsController {
  private readonly logger = createLogger('IncidentRewardsController');

  constructor(
    private readonly storage: IncidentRewardsStorage,
    private readonly slotStorage: SlotStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async runSync(): Promise<void> {
    // Rewards can only advance through slots that the slot pipeline has already
    // indexed into the reward tables.
    const lastIndexedSlot = await this.slotStorage.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Attestation rewards arrive per epoch, so never advance beyond the last
    // epoch whose rewards have already been persisted.
    const lastRewardsFetchedEpoch = await this.storage.getLastRewardsFetchedEpoch();
    if (lastRewardsFetchedEpoch === null) {
      return;
    }

    const lastRewardsFetchedSlot = this.beaconTime.getEpochSlots(lastRewardsFetchedEpoch).endSlot;
    const safeProcessThroughSlot = Math.min(lastIndexedSlot, lastRewardsFetchedSlot);

    if (safeProcessThroughSlot < 0) {
      return;
    }

    // Delegate the actual reward reconciliation once the upper bound is known.
    await this.syncOpenIncidentRewards({
      processThroughSlot: safeProcessThroughSlot,
    });
  }

  async syncOpenIncidentRewards(params: SyncOpenIncidentRewardsParams): Promise<void> {
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
