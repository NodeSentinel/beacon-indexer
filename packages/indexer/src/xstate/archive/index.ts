import { createActor } from 'xstate';

import { hourlyArchiveMachine } from './hourlyArchive.machine.js';

import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { hourlyArchiveMachine } from './hourlyArchive.machine.js';

/**
 * Creates and returns the hourly archive actor.
 * The actor should be started before passing it to the epoch orchestrator.
 */
export const getHourlyArchiveActor = (hourlyArchiveController: HourlyArchiveController) => {
  const actor = createActor(hourlyArchiveMachine, {
    input: {
      hourlyArchiveController,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('hourlyArchive', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
