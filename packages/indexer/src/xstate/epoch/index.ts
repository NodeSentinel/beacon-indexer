import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { ActorRefFrom, createActor } from 'xstate';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { dailyArchiveMachine } from '@/src/xstate/archive/dailyArchive.machine.js';
import { hourlyArchiveMachine } from '@/src/xstate/archive/hourlyArchive.machine.js';
import { monthlyArchiveMachine } from '@/src/xstate/archive/monthlyArchive.machine.js';
import { chainStatsMachine } from '@/src/xstate/chainStats/chainStats.machine.js';
import { epochCreationMachine } from '@/src/xstate/epoch/epochCreator.machine.js';
import { epochOrchestratorMachine } from '@/src/xstate/epoch/epochOrchestrator.machine.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

export const getCreateEpochActor = (epochController: EpochController, slotDuration: number) => {
  const actor = createActor(epochCreationMachine, {
    input: { slotDuration, epochController },
  });

  actor.subscribe((snapshot) => {
    const { context } = snapshot;

    // Trace the epoch creator state with only the fields it owns.
    logMachine(
      'epochCreator',
      `State: ${JSON.stringify(snapshot.value)}`,
      {
        slotDuration: context.slotDuration,
      },
      {
        buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
          buildTraceDefinition({
            machineGroup: 'epoch',
            machineName: 'epochCreator',
            machineId,
            state,
            context,
            traceRootId,
            parentMachineId,
            fieldKeys: ['slotDuration'],
            messagePrefix: 'epochCreator',
          }),
      },
    );
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
  dailyArchiveActor: ActorRefFrom<typeof dailyArchiveMachine>,
  monthlyArchiveActor: ActorRefFrom<typeof monthlyArchiveMachine>,
  chainStatsActor: ActorRefFrom<typeof chainStatsMachine>,
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
      dailyArchiveActor,
      monthlyArchiveActor,
      chainStatsActor,
    },
  });

  actor.subscribe((snapshot) => {
    const { context } = snapshot;

    // Get information about active epochs
    const activeEpochs = Object.keys(context.epochs)
      .map((e) => parseInt(e))
      .sort((a, b) => a - b);

    // Trace the orchestrator state with the current active epoch set.
    logMachine(
      'epochOrchestrator',
      `State: ${JSON.stringify(snapshot.value)}`,
      {
        // Active epochs being processed
        activeEpochs,
        // Epochs status map
        epochsStatus: context.epochs,
      },
      {
        buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
          buildTraceDefinition({
            machineGroup: 'epoch',
            machineName: 'epochOrchestrator',
            machineId,
            state,
            context,
            traceRootId,
            parentMachineId,
            fields: {
              activeEpochs: activeEpochs.join(','),
            },
            messagePrefix: 'epochOrchestrator',
          }),
      },
    );
  });

  return actor;
};
