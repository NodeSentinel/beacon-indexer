import { setup, fromPromise } from 'xstate';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      incidentRewardsController: IncidentRewardsController;
    };
  }) => {
    // Delegate the entire sweep to the controller so the machine stays focused
    // on scheduling only.
    await input.incidentRewardsController.runSync();
  },
);

export const incidentRewardsMachine = setup({
  types: {} as {
    context: {
      incidentRewardsController: IncidentRewardsController;
    };
    input: {
      incidentRewardsController: IncidentRewardsController;
    };
  },
  delays: {
    // Reward finalization is less latency-sensitive than incident detection, so a
    // coarse periodic sweep is enough.
    syncInterval: () => 30 * 60 * 1000,
  },
  actors: {
    runSync,
  },
}).createMachine({
  id: 'IncidentRewards',
  initial: 'waiting',
  context: ({ input }) => ({
    incidentRewardsController: input.incidentRewardsController,
  }),
  states: {
    waiting: {
      // Sleep until the next periodic reward sweep.
      after: {
        syncInterval: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
        // Run a single reward sync pass and always return to waiting, whether the
        // pass completed normally or failed.
        src: 'runSync',
        input: ({ context }) => ({
          incidentRewardsController: context.incidentRewardsController,
        }),
        onDone: {
          target: 'waiting',
          actions: [pinoLog(() => 'Incident rewards sync completed', 'IncidentRewards')],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(
              ({ event }) => `Incident rewards sync error: ${event.error}`,
              'IncidentRewards',
              'error',
            ),
          ],
        },
      },
    },
  },
});
