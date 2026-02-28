import { setup, fromPromise } from 'xstate';

import { WeeklyArchiveController } from '@/src/services/consensus/controllers/weeklyArchive.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The weekly archive machine aggregates daily archives into weekly archives.
 *
 * Triggered by EPOCH_PROCESSED events from the epoch orchestrator.
 * Same pattern as dailyArchiveMachine:
 * - Event-driven triggering (no polling)
 * - Non-overlapping execution (ignores events while archiving)
 * - Error handling with retry on next epoch
 */

export const weeklyArchiveMachine = setup({
  types: {} as {
    context: {
      weeklyArchiveController: WeeklyArchiveController;
    };
    events: { type: 'EPOCH_PROCESSED'; epoch: number };
    input: {
      weeklyArchiveController: WeeklyArchiveController;
    };
  },
  actors: {
    runArchive: fromPromise(
      async ({ input }: { input: { controller: WeeklyArchiveController } }) => {
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
  id: 'WeeklyArchive',
  initial: 'idle',
  context: ({ input }) => ({
    weeklyArchiveController: input.weeklyArchiveController,
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
                `Received EPOCH_PROCESSED for epoch ${event.epoch}, checking weekly archive eligibility`,
              'WeeklyArchive',
            ),
          ],
        },
      },
    },
    archiving: {
      description: 'Archiving the oldest eligible week',
      invoke: {
        src: 'runArchive',
        input: ({ context }) => ({
          controller: context.weeklyArchiveController,
        }),
        onDone: [
          {
            guard: 'archiveSucceeded',
            target: 'idle',
            actions: [
              pinoLog(({ event }) => {
                const week = event.output as Date;
                return `Weekly archive completed: week=${week.toISOString()}`;
              }, 'WeeklyArchive'),
            ],
          },
          {
            target: 'idle',
            actions: [pinoLog(() => 'No eligible week found for weekly archive', 'WeeklyArchive')],
          },
        ],
        onError: {
          target: 'idle',
          actions: [
            pinoLog(
              ({ event }) => `Weekly archive error: ${event.error}`,
              'WeeklyArchive',
              'error',
            ),
          ],
        },
      },
      // While archiving, ignore additional EPOCH_PROCESSED events
      on: {
        EPOCH_PROCESSED: {
          actions: pinoLog(
            ({ event }) =>
              `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - weekly archive already in progress`,
            'WeeklyArchive',
            'debug',
          ),
        },
      },
    },
  },
});
