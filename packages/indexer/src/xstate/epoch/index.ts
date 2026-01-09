import { createActor, ActorRefFrom } from 'xstate';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/beaconTime.js';
import { hourlyArchiveMachine } from '@/src/xstate/archive/hourlyArchive.machine.js';
import { epochCreationMachine } from '@/src/xstate/epoch/epochCreator.machine.js';
import { epochOrchestratorMachine } from '@/src/xstate/epoch/epochOrchestrator.machine.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export const getCreateEpochActor = (epochController: EpochController, slotDuration: number) => {
  const actor = createActor(epochCreationMachine, {
    input: {
      slotDuration,
      epochController,
    },
  });

  actor.subscribe((snapshot) => {
    const { context } = snapshot;

    logMachine('epochCreator', `State: ${JSON.stringify(snapshot.value)}`, {
      // Current state info
      slotDuration: context.slotDuration,
    });
  });

  return actor;
};

export const getEpochOrchestratorActor = (
  epochController: EpochController,
  partitionController: PartitionController,
  beaconTime: BeaconTime,
  slotDuration: number,
  slotsPerEpoch: number,
  slotController: SlotController,
  validatorsController: ValidatorsController,
  hourlyArchiveActor: ActorRefFrom<typeof hourlyArchiveMachine>,
) => {
  const actor = createActor(epochOrchestratorMachine, {
    input: {
      slotDuration,
      slotsPerEpoch,
      lookbackSlot: beaconTime.getLookbackSlot(),
      epochController,
      partitionController,
      beaconTime,
      slotController,
      validatorsController,
      hourlyArchiveActor,
    },
  });

  actor.subscribe((snapshot) => {
    const { context } = snapshot;

    // Get information about active epochs
    const activeEpochs = Object.keys(context.epochs)
      .map((e) => parseInt(e))
      .sort((a, b) => a - b);

    logMachine('epochOrchestrator', `State: ${JSON.stringify(snapshot.value)}`, {
      // Active epochs being processed
      activeEpochs,
      // Epochs status map
      epochsStatus: context.epochs,
    });
  });

  return actor;
};
