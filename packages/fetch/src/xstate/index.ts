import { getCreateEpochActor, getEpochOrchestratorActor } from './epoch/index.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';

export default function initXstateMachines(
  epochController: EpochController,
  beaconTime: BeaconTime,
  slotDuration: number,
  slotController: SlotController,
) {
  getCreateEpochActor(epochController, slotDuration).start();

  getEpochOrchestratorActor(epochController, beaconTime, slotDuration, slotController).start();

  // committeeCleanup: {
  //   invoke: {
  //     src: 'cleanupOldCommittees',
  //     input: ({ context }) => ({
  //       slot: context.slot,
  //     }),
  //     onDone: {
  //       target: 'complete',
  //       actions: assign({}),
  //     },
  //     onError: {
  //       target: 'committeeCleanup',
  //     },
  //   },
  // },
}
