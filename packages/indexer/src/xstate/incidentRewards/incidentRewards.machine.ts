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
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

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
      after: {
        syncInterval: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
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
