import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { getCreateEpochActor, getEpochOrchestratorActor } from '@/src/xstate/epoch/index.js';

export default function initXstateMachines(
  epochController: EpochController,
  beaconTime: BeaconTime,
  slotDuration: number,
) {
  getCreateEpochActor(epochController, slotDuration).start();

  getEpochOrchestratorActor(epochController, beaconTime, slotDuration).start();

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
