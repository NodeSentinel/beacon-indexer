import { createActor } from 'xstate';

import { dailyArchiveMachine } from './dailyArchive.machine.js';
import { dailyArchiveDetailCleanupMachine } from './dailyArchiveDetailCleanup.machine.js';
import { hourlyArchiveMachine } from './hourlyArchive.machine.js';
import { monthlyArchiveMachine } from './monthlyArchive.machine.js';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { DailyArchiveDetailCleanupController } from '@/src/services/consensus/controllers/dailyArchiveDetailCleanup.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';

export { hourlyArchiveMachine } from './hourlyArchive.machine.js';
export { dailyArchiveMachine } from './dailyArchive.machine.js';
export { dailyArchiveDetailCleanupMachine } from './dailyArchiveDetailCleanup.machine.js';
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

  return actor;
};

/**
 * Creates and returns the daily archive detail cleanup actor.
 */
export const getDailyArchiveDetailCleanupActor = (
  dailyArchiveDetailCleanupController: DailyArchiveDetailCleanupController,
) => {
  const actor = createActor(dailyArchiveDetailCleanupMachine, {
    input: {
      dailyArchiveDetailCleanupController,
    },
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

  return actor;
};
