import ms from 'ms';
import { fromPromise, setup } from 'xstate';

import { DailyArchiveDetailCleanupController } from '@/src/services/consensus/controllers/dailyArchiveDetailCleanup.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const DAILY_ARCHIVE_DETAIL_CLEANUP_INTERVAL_MS = ms('10m');
const LOGGER_CONTEXT = 'DailyArchiveDetailCleanup';

/**
 * @fileoverview The daily archive detail cleanup machine periodically removes old JSON detail.
 */

const cleanupOldDailyDetails = fromPromise(
  async ({
    input,
  }: {
    input: {
      dailyArchiveDetailCleanupController: DailyArchiveDetailCleanupController;
    };
  }) => {
    // Keep cleanup rules in the controller; the machine only schedules runs.
    return await input.dailyArchiveDetailCleanupController.cleanupOldDailyDetails();
  },
);

export const dailyArchiveDetailCleanupMachine = setup({
  types: {} as {
    context: {
      dailyArchiveDetailCleanupController: DailyArchiveDetailCleanupController;
    };
    input: {
      dailyArchiveDetailCleanupController: DailyArchiveDetailCleanupController;
    };
  },
  delays: {
    // Run independently from daily archiving so finalizing a day never waits on
    // historical JSON cleanup.
    cleanupInterval: () => DAILY_ARCHIVE_DETAIL_CLEANUP_INTERVAL_MS,
  },
  actors: {
    cleanupOldDailyDetails,
  },
}).createMachine({
  id: 'DailyArchiveDetailCleanup',
  initial: 'waiting',
  context: ({ input }) => ({
    dailyArchiveDetailCleanupController: input.dailyArchiveDetailCleanupController,
  }),
  states: {
    waiting: {
      description: 'Waiting for the next daily archive detail cleanup interval',
      after: {
        cleanupInterval: {
          target: 'cleaning',
        },
      },
    },
    cleaning: {
      description: 'Cleaning old daily archive JSON detail in bounded batches',
      invoke: {
        src: 'cleanupOldDailyDetails',
        input: ({ context }) => ({
          dailyArchiveDetailCleanupController: context.dailyArchiveDetailCleanupController,
        }),
        onDone: {
          target: 'waiting',
          actions: [
            pinoLog(({ event }) => {
              const result = event.output;
              return `Daily archive detail cleanup completed: batches=${result.batches} rows=${result.rows}`;
            }, LOGGER_CONTEXT),
          ],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(
              ({ event }) => `Daily archive detail cleanup error: ${event.error}`,
              LOGGER_CONTEXT,
              'error',
            ),
          ],
        },
      },
    },
  },
});
