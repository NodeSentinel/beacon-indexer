import { setup, fromPromise } from 'xstate';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      skipValidatorStatusUpdateWhenBehindHeadSlots: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  }) => {
    // Delegate the entire refresh pass to the controller so the machine stays
    // orchestration-only.
    await input.validatorActivityStatusController.runSync({
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
      slotDuration: number;
      skipValidatorStatusUpdateWhenBehindHeadSlots: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
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
