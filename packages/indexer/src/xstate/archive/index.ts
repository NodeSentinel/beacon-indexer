import { createActor } from 'xstate';

import { dailyArchiveMachine } from './dailyArchive.machine.js';
import { hourlyArchiveMachine } from './hourlyArchive.machine.js';
import { monthlyArchiveMachine } from './monthlyArchive.machine.js';
import { weeklyArchiveMachine } from './weeklyArchive.machine.js';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { WeeklyArchiveController } from '@/src/services/consensus/controllers/weeklyArchive.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { hourlyArchiveMachine } from './hourlyArchive.machine.js';
export { dailyArchiveMachine } from './dailyArchive.machine.js';
export { weeklyArchiveMachine } from './weeklyArchive.machine.js';
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
    logMachine('hourlyArchive', `State: ${JSON.stringify(snapshot.value)}`);
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
    logMachine('dailyArchive', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};

/**
 * Creates and returns the weekly archive actor.
 */
export const getWeeklyArchiveActor = (weeklyArchiveController: WeeklyArchiveController) => {
  const actor = createActor(weeklyArchiveMachine, {
    input: {
      weeklyArchiveController,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('weeklyArchive', `State: ${JSON.stringify(snapshot.value)}`);
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
    logMachine('monthlyArchive', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
