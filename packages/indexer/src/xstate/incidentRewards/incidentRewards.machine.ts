import { setup, fromPromise } from 'xstate';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      incidentRewardsController: IncidentRewardsController;
      slotController: SlotController;
    };
  }) => {
    // Rewards can only advance up to the latest indexed slot, because both
    // attestation and sync reward tables are populated by the slot pipeline.
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Delegate reward accumulation and finalization rules to the controller so
    // the machine stays focused on scheduling.
    await input.incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot: lastIndexedSlot,
    });
  },
);

export const incidentRewardsMachine = setup({
  types: {} as {
    context: {
      incidentRewardsController: IncidentRewardsController;
      slotController: SlotController;
    };
    input: {
      incidentRewardsController: IncidentRewardsController;
      slotController: SlotController;
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
    slotController: input.slotController,
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
          slotController: context.slotController,
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
