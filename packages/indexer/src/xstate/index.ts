import { getCreateEpochActor, getEpochOrchestratorActor } from './epoch/index.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/beaconTime.js';

export default function initXstateMachines(
  epochController: EpochController,
  partitionController: PartitionController,
  beaconTime: BeaconTime,
  slotDuration: number,
  slotsPerEpoch: number,
  slotController: SlotController,
  validatorsController: ValidatorsController,
) {
  getCreateEpochActor(epochController, slotDuration).start();

  getEpochOrchestratorActor(
    epochController,
    partitionController,
    beaconTime,
    slotDuration,
    slotsPerEpoch,
    slotController,
    validatorsController,
  ).start();

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
