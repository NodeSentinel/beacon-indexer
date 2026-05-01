import { fromPromise, setup } from 'xstate';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { endPerformanceTask, startPerformanceTask } from '@/src/xstate/performanceLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const VALIDATOR_ACTIVITY_STATUS_POLLING_INTERVAL_MS = 1000;

// The activity worker runs often, but the controller evaluates only mature duty
// slots. Example: with maxAttestationDelay = 5 and latest processed slot = 105,
// validator duties for slot 100 can be judged. A null attestation delay at slot
// 100 is then a missed duty; an attestation delay <= 5 is successful. The worker
// advances that evaluated-duty cursor and updates the validator activity
// snapshot, which can open or close cluster incidents.
const syncCurrentActivityStatus = fromPromise(
  async ({
    input,
  }: {
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  }) => {
    // Delegate the entire refresh pass to the controller so the machine stays
    // orchestration-only.
    await input.validatorActivityStatusController.syncCurrentActivityStatus({
      maxAttestationDelay: input.maxAttestationDelay,
      inactiveMissedCount: input.inactiveMissedCount,
    });
  },
);

export const validatorActivityStatusMachine = setup({
  types: {} as {
    context: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
    input: {
      validatorActivityStatusController: ValidatorActivityStatusController;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  },
  delays: {
    // Poll quickly so incidents are opened soon after slot processing completes.
    tickInterval: () => VALIDATOR_ACTIVITY_STATUS_POLLING_INTERVAL_MS,
  },
  actors: {
    syncCurrentActivityStatus,
  },
}).createMachine({
  id: 'ValidatorActivityStatus',
  initial: 'waiting',
  context: ({ input }) => ({
    validatorActivityStatusController: input.validatorActivityStatusController,
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
      entry: startPerformanceTask('syncing'),
      exit: endPerformanceTask('syncing'),
      invoke: {
        // Execute one refresh pass and always return to the waiting state whether
        // the pass succeeded or failed.
        src: 'syncCurrentActivityStatus',
        input: ({ context }) => ({
          validatorActivityStatusController: context.validatorActivityStatusController,
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
