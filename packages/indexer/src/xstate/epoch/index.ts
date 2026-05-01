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

export const getCreateEpochActor = (epochController: EpochController, slotDuration: number) => {
  const actor = createActor(epochCreationMachine, {
    input: { slotDuration, epochController },
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

  return actor;
};
