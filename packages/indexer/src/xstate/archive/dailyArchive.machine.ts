import { fromPromise, setup } from 'xstate';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { endPerformanceTask, startPerformanceTask } from '@/src/xstate/performanceLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The daily archive machine aggregates hourly archives into daily archives.
 *
 * Triggered by EPOCH_PROCESSED events from the epoch orchestrator.
 * Same pattern as hourlyArchiveMachine:
 * - Event-driven triggering (no polling)
 * - Non-overlapping execution (ignores events while archiving)
 * - Error handling with retry on next epoch
 */

export const dailyArchiveMachine = setup({
  types: {} as {
    context: {
      dailyArchiveController: DailyArchiveController;
    };
    events: { type: 'EPOCH_PROCESSED'; epoch: number };
    input: {
      dailyArchiveController: DailyArchiveController;
    };
  },
  actors: {
    runArchive: fromPromise(
      async ({ input }: { input: { controller: DailyArchiveController } }) => {
        return await input.controller.archive();
      },
    ),
  },
  guards: {
    archiveSucceeded: ({ event }) => {
      if (!('output' in event)) return false;
      const output = event.output as Date | null;
      return output !== null;
    },
  },
}).createMachine({
  id: 'DailyArchive',
  initial: 'idle',
  context: ({ input }) => ({
    dailyArchiveController: input.dailyArchiveController,
  }),
  states: {
    idle: {
      description: 'Waiting for EPOCH_PROCESSED event',
      on: {
        EPOCH_PROCESSED: {
          target: 'archiving',
          actions: [
            pinoLog(
              ({ event }) =>
                `Received EPOCH_PROCESSED for epoch ${event.epoch}, checking daily archive eligibility`,
              'DailyArchive',
            ),
          ],
        },
      },
    },
    archiving: {
      description: 'Archiving the oldest eligible day',
      entry: startPerformanceTask('archiving'),
      exit: endPerformanceTask('archiving'),
      invoke: {
        src: 'runArchive',
        input: ({ context }) => ({
          controller: context.dailyArchiveController,
        }),
        onDone: [
          {
            guard: 'archiveSucceeded',
            target: 'idle',
            actions: [
              pinoLog(({ event }) => {
                const day = event.output as Date;
                return `Daily archive completed: day=${day.toISOString()}`;
              }, 'DailyArchive'),
            ],
          },
          {
            target: 'idle',
            actions: [pinoLog(() => 'No eligible day found for daily archive', 'DailyArchive')],
          },
        ],
        onError: {
          target: 'idle',
          actions: [
            pinoLog(({ event }) => `Daily archive error: ${event.error}`, 'DailyArchive', 'error'),
          ],
        },
      },
      // While archiving, ignore additional EPOCH_PROCESSED events
      on: {
        EPOCH_PROCESSED: {
          actions: pinoLog(
            ({ event }) =>
              `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - daily archive already in progress`,
            'DailyArchive',
            'debug',
          ),
        },
      },
    },
  },
});
