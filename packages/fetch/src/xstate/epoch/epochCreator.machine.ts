import { setup } from 'xstate';

import { createEpochsIfNeeded } from './epoch.actors.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';

export const epochCreationMachine = setup({
  types: {} as {
    context: {
      epochController: EpochController;
      slotDuration: number;
    };
    input: {
      slotDuration: number;
      epochController: EpochController;
    };
  },
  actors: {
    createEpochsIfNeeded,
  },
  delays: {
    slotDuration: ({ context }) => context.slotDuration,
  },
}).createMachine({
  id: 'EpochCreator',
  initial: 'createEpochs',
  description: 'The epoch creator is a state machine that is responsible for creating epochs.',
  context: ({ input }) => ({
    epochController: input.epochController,
    slotDuration: input.slotDuration,
  }),
  states: {
    createEpochs: {
      invoke: {
        src: 'createEpochsIfNeeded',
        input: ({ context }) => ({ epochController: context.epochController }),
        onDone: 'sleep',
        onError: 'sleep',
      },
    },
    sleep: {
      after: {
        slotDuration: {
          target: 'createEpochs',
        },
      },
    },
  },
});
