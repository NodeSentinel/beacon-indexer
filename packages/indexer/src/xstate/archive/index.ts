import { createActor } from 'xstate';

import { dailyArchiveMachine } from './dailyArchive.machine.js';
import { hourlyArchiveMachine } from './hourlyArchive.machine.js';
import { monthlyArchiveMachine } from './monthlyArchive.machine.js';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

export { hourlyArchiveMachine } from './hourlyArchive.machine.js';
export { dailyArchiveMachine } from './dailyArchive.machine.js';
export { monthlyArchiveMachine } from './monthlyArchive.machine.js';

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
    // Trace the hourly archive machine with its current state only.
    logMachine('hourlyArchive', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'archive',
          machineName: 'hourlyArchive',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'hourlyArchive',
        }),
    });
  });

  return actor;
};

/**
 * Creates and returns the daily archive actor.
 */
export const getDailyArchiveActor = (dailyArchiveController: DailyArchiveController) => {
  const actor = createActor(dailyArchiveMachine, {
    input: {
      dailyArchiveController,
    },
  });

  actor.subscribe((snapshot) => {
    // Trace the daily archive machine with its current state only.
    logMachine('dailyArchive', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'archive',
          machineName: 'dailyArchive',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'dailyArchive',
        }),
    });
  });

  return actor;
};

/**
 * Creates and returns the monthly archive actor.
 */
export const getMonthlyArchiveActor = (monthlyArchiveController: MonthlyArchiveController) => {
  const actor = createActor(monthlyArchiveMachine, {
    input: {
      monthlyArchiveController,
    },
  });

  actor.subscribe((snapshot) => {
    // Trace the monthly archive machine with its current state only.
    logMachine('monthlyArchive', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'archive',
          machineName: 'monthlyArchive',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'monthlyArchive',
        }),
    });
  });

  return actor;
};
