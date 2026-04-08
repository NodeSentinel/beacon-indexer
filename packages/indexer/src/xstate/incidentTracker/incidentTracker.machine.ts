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
      inactiveMissedCount: number;
    };
  }) => {
    // Wait for the slot processor to publish a durable cursor before trying to
    // open or close incidents from committee data.
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Keep the machine orchestration-only by delegating all duty-window logic to
    // the controller and storage layers.
    await input.incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot,
      maxAttestationDelay: input.maxAttestationDelay,
      inactiveMissedCount: input.inactiveMissedCount,
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
      inactiveMissedCount: number;
    };
    input: {
      incidentTrackerController: IncidentTrackerController;
      slotController: SlotController;
      slotDuration: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  },
  delays: {
    // Poll once per slot so incident openings and closures stay near real time
    // without busy-looping.
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
    inactiveMissedCount: input.inactiveMissedCount,
  }),
  states: {
    waiting: {
      // Sleep until the next slot-sized tick before checking whether more duties
      // became safe to process.
      after: {
        tickInterval: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
        // Run a single durable incident-tracker pass and always transition back
        // to waiting, regardless of success or failure.
        src: 'runSync',
        input: ({ context }) => ({
          incidentTrackerController: context.incidentTrackerController,
          slotController: context.slotController,
          maxAttestationDelay: context.maxAttestationDelay,
          inactiveMissedCount: context.inactiveMissedCount,
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
