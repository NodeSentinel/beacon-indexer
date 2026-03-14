import { setup, fromPromise } from 'xstate';

import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';
import { sendTelegramError } from '@/src/xstate/telegramAlert.js';

/**
 * @fileoverview The monthly archive machine aggregates daily archives into monthly archives.
 *
 * Triggered by EPOCH_PROCESSED events from the epoch orchestrator.
 * Same pattern as dailyArchiveMachine:
 * - Event-driven triggering (no polling)
 * - Non-overlapping execution (ignores events while archiving)
 * - Error handling with retry on next epoch
 */

export const monthlyArchiveMachine = setup({
  types: {} as {
    context: {
      monthlyArchiveController: MonthlyArchiveController;
    };
    events: { type: 'EPOCH_PROCESSED'; epoch: number };
    input: {
      monthlyArchiveController: MonthlyArchiveController;
    };
  },
  actors: {
    runArchive: fromPromise(
      async ({ input }: { input: { controller: MonthlyArchiveController } }) => {
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
  id: 'MonthlyArchive',
  initial: 'idle',
  context: ({ input }) => ({
    monthlyArchiveController: input.monthlyArchiveController,
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
                `Received EPOCH_PROCESSED for epoch ${event.epoch}, checking monthly archive eligibility`,
              'MonthlyArchive',
            ),
          ],
        },
      },
    },
    archiving: {
      description: 'Archiving the oldest eligible month',
      invoke: {
        src: 'runArchive',
        input: ({ context }) => ({
          controller: context.monthlyArchiveController,
        }),
        onDone: [
          {
            guard: 'archiveSucceeded',
            target: 'idle',
            actions: [
              pinoLog(({ event }) => {
                const month = event.output as Date;
                return `Monthly archive completed: month=${month.toISOString()}`;
              }, 'MonthlyArchive'),
            ],
          },
          {
            target: 'idle',
            actions: [
              pinoLog(() => 'No eligible month found for monthly archive', 'MonthlyArchive'),
            ],
          },
        ],
        onError: {
          target: 'idle',
          actions: [
            pinoLog(
              ({ event }) => `Monthly archive error: ${event.error}`,
              'MonthlyArchive',
              'error',
            ),
            sendTelegramError(
              ({ event }) => `Monthly archive error: ${event.error}`,
              'MonthlyArchive',
            ),
          ],
        },
      },
      // While archiving, ignore additional EPOCH_PROCESSED events
      on: {
        EPOCH_PROCESSED: {
          actions: pinoLog(
            ({ event }) =>
              `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - monthly archive already in progress`,
            'MonthlyArchive',
            'debug',
          ),
        },
      },
    },
  },
});
