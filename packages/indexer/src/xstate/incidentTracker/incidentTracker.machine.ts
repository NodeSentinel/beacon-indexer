import { setup, fromPromise } from 'xstate';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      incidentTrackerController: IncidentTrackerController;
      slotController: SlotController;
      maxAttestationDelay: number;
    };
  }) => {
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    await input.incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot,
      maxAttestationDelay: input.maxAttestationDelay,
    });
  },
);

export const incidentTrackerMachine = setup({
  types: {} as {
    context: {
      incidentTrackerController: IncidentTrackerController;
      slotController: SlotController;
      slotDuration: number;
      maxAttestationDelay: number;
    };
    input: {
      incidentTrackerController: IncidentTrackerController;
      slotController: SlotController;
      slotDuration: number;
      maxAttestationDelay: number;
    };
  },
  delays: {
    tickInterval: ({ context }) => context.slotDuration,
  },
  actors: {
    runSync,
  },
}).createMachine({
  id: 'IncidentTracker',
  initial: 'waiting',
  context: ({ input }) => ({
    incidentTrackerController: input.incidentTrackerController,
    slotController: input.slotController,
    slotDuration: input.slotDuration,
    maxAttestationDelay: input.maxAttestationDelay,
  }),
  states: {
    waiting: {
      after: {
        tickInterval: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
        src: 'runSync',
        input: ({ context }) => ({
          incidentTrackerController: context.incidentTrackerController,
          slotController: context.slotController,
          maxAttestationDelay: context.maxAttestationDelay,
        }),
        onDone: {
          target: 'waiting',
          actions: [pinoLog(() => 'Incident tracker sync completed', 'IncidentTracker')],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(
              ({ event }) => `Incident tracker sync error: ${event.error}`,
              'IncidentTracker',
              'error',
            ),
          ],
        },
      },
    },
  },
});
