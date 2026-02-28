import { setup, fromPromise } from 'xstate';

import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

export const chainStatsMachine = setup({
  types: {} as {
    context: {
      chainStatsController: ChainStatsController;
    };
    events: { type: 'EPOCH_PROCESSED'; epoch: number };
    input: {
      chainStatsController: ChainStatsController;
    };
  },
  actors: {
    runComputeStats: fromPromise(
      async ({ input }: { input: { controller: ChainStatsController; epoch: number } }) => {
        return await input.controller.computeStats(input.epoch);
      },
    ),
  },
}).createMachine({
  id: 'ChainStats',
  initial: 'idle',
  context: ({ input }) => ({
    chainStatsController: input.chainStatsController,
  }),
  states: {
    idle: {
      description: 'Waiting for EPOCH_PROCESSED event',
      on: {
        EPOCH_PROCESSED: {
          target: 'computing',
          actions: [
            pinoLog(
              ({ event }) =>
                `Received EPOCH_PROCESSED for epoch ${event.epoch}, computing chain stats`,
              'ChainStats',
            ),
          ],
        },
      },
    },
    computing: {
      description: 'Computing and upserting chain stats for the epoch',
      invoke: {
        src: 'runComputeStats',
        input: ({ context, event }) => ({
          controller: context.chainStatsController,
          epoch: (event as { type: 'EPOCH_PROCESSED'; epoch: number }).epoch,
        }),
        onDone: {
          target: 'idle',
          actions: [
            pinoLog(({ event }) => {
              const { epoch, skipped } = event.output;
              return skipped
                ? `Chain stats skipped for epoch ${epoch} (already exists)`
                : `Chain stats computed for epoch ${epoch}`;
            }, 'ChainStats'),
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            pinoLog(({ event }) => `Chain stats error: ${event.error}`, 'ChainStats', 'error'),
          ],
        },
      },
      // While computing, ignore additional EPOCH_PROCESSED events (non-overlap)
      on: {
        EPOCH_PROCESSED: {
          actions: pinoLog(
            ({ event }) =>
              `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - chain stats computation in progress`,
            'ChainStats',
            'debug',
          ),
        },
      },
    },
  },
});
