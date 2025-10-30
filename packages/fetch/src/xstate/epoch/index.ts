import { createActor } from 'xstate';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
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
  beaconTime: BeaconTime,
  slotDuration: number,
  slotController: SlotController,
) => {
  const actor = createActor(epochOrchestratorMachine, {
    input: {
      slotDuration,
      lookbackSlot: beaconTime.getSlotStartIndexing(),
      epochController,
      beaconTime,
      slotController,
    },
  });

  actor.subscribe((snapshot) => {
    const { context } = snapshot;

    // Get information about the current epoch actor if it exists
    const epochActorInfo = context.epochActor
      ? {
          state: context.epochActor.getSnapshot().value,
          epochData: context.epochData,
        }
      : null;

    logMachine('epochOrchestrator', `State: ${JSON.stringify(snapshot.value)}`, {
      // Current epoch being processed
      currentEpoch: context.epochData?.epoch || null,
      // Active epoch processor if any
      spawnedEpochProcessor: epochActorInfo,
    });
  });

  return actor;
};
