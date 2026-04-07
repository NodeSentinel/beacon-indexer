import { fromPromise, setup } from 'xstate';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorRewardsProgressController } from '@/src/services/consensus/controllers/validatorRewardsProgress.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      validatorRewardsProgressController: ValidatorRewardsProgressController;
      slotController: SlotController;
    };
  }) => {
    const lastIndexedSlot = await input.slotController.getLastProcessedSlot();
    if (lastIndexedSlot === null) {
      return;
    }

    await input.validatorRewardsProgressController.syncValidatorRewardsProgress({
      processThroughSlot: lastIndexedSlot,
    });
  },
);

export const validatorRewardsProgressMachine = setup({
  types: {} as {
    context: {
      validatorRewardsProgressController: ValidatorRewardsProgressController;
      slotController: SlotController;
    };
    input: {
      validatorRewardsProgressController: ValidatorRewardsProgressController;
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
  id: 'ValidatorRewardsProgress',
  initial: 'waiting',
  context: ({ input }) => ({
    validatorRewardsProgressController: input.validatorRewardsProgressController,
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
          validatorRewardsProgressController: context.validatorRewardsProgressController,
          slotController: context.slotController,
        }),
        onDone: {
          target: 'waiting',
          actions: [
            pinoLog(() => 'Validator rewards progress sync completed', 'ValidatorRewardsProgress'),
          ],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(
              ({ event }) => `Validator rewards progress sync error: ${event.error}`,
              'ValidatorRewardsProgress',
              'error',
            ),
          ],
        },
      },
    },
  },
});
