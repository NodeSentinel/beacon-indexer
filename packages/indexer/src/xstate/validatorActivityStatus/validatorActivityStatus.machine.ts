import { setup, fromPromise } from 'xstate';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      slotController: SlotController;
      maxIndexerLagSlotsForAlerts: number;
      maxAttestationDelay: number;
    };
  }) => {
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    await input.validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot,
      maxIndexerLagSlotsForAlerts: input.maxIndexerLagSlotsForAlerts,
      maxAttestationDelay: input.maxAttestationDelay,
    });
  },
);

export const validatorActivityStatusMachine = setup({
  types: {} as {
    context: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      slotController: SlotController;
      slotDuration: number;
      maxIndexerLagSlotsForAlerts: number;
      maxAttestationDelay: number;
    };
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      slotController: SlotController;
      slotDuration: number;
      maxIndexerLagSlotsForAlerts: number;
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
  id: 'ValidatorActivityStatus',
  initial: 'waiting',
  context: ({ input }) => ({
    validatorActivityStatusController: input.validatorActivityStatusController,
    slotController: input.slotController,
    slotDuration: input.slotDuration,
    maxIndexerLagSlotsForAlerts: input.maxIndexerLagSlotsForAlerts,
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
          validatorActivityStatusController: context.validatorActivityStatusController,
          slotController: context.slotController,
          maxIndexerLagSlotsForAlerts: context.maxIndexerLagSlotsForAlerts,
          maxAttestationDelay: context.maxAttestationDelay,
        }),
        onDone: {
          target: 'waiting',
          actions: [
            pinoLog(() => 'Validator activity status sync completed', 'ValidatorActivityStatus'),
          ],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(
              ({ event }) => `Validator activity status sync error: ${event.error}`,
              'ValidatorActivityStatus',
              'error',
            ),
          ],
        },
      },
    },
  },
});
