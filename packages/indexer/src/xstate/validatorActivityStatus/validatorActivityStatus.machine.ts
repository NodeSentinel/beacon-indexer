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
      skipValidatorStatusUpdateWhenBehindHeadSlots: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  }) => {
    // Skip the run entirely until the slot processor has indexed at least one
    // slot, because there is no durable committee window to evaluate before then.
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    // Delegate the freshness gate and safe-slot calculation to the controller so
    // the machine remains orchestration-only.
    await input.validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot,
      skipValidatorStatusUpdateWhenBehindHeadSlots:
        input.skipValidatorStatusUpdateWhenBehindHeadSlots,
      maxAttestationDelay: input.maxAttestationDelay,
      inactiveMissedCount: input.inactiveMissedCount,
    });
  },
);

export const validatorActivityStatusMachine = setup({
  types: {} as {
    context: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      slotController: SlotController;
      slotDuration: number;
      skipValidatorStatusUpdateWhenBehindHeadSlots: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      slotController: SlotController;
      slotDuration: number;
      skipValidatorStatusUpdateWhenBehindHeadSlots: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  },
  delays: {
    // Poll at slot cadence so validator activity state tracks the latest safe slot
    // as soon as new committee data becomes final.
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
    skipValidatorStatusUpdateWhenBehindHeadSlots:
      input.skipValidatorStatusUpdateWhenBehindHeadSlots,
    maxAttestationDelay: input.maxAttestationDelay,
    inactiveMissedCount: input.inactiveMissedCount,
  }),
  states: {
    waiting: {
      // Sleep until the next slot-sized tick before attempting another refresh.
      after: {
        tickInterval: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
        // Execute one refresh pass and always return to the waiting state whether
        // the pass succeeded or failed.
        src: 'runSync',
        input: ({ context }) => ({
          validatorActivityStatusController: context.validatorActivityStatusController,
          slotController: context.slotController,
          skipValidatorStatusUpdateWhenBehindHeadSlots:
            context.skipValidatorStatusUpdateWhenBehindHeadSlots,
          maxAttestationDelay: context.maxAttestationDelay,
          inactiveMissedCount: context.inactiveMissedCount,
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
