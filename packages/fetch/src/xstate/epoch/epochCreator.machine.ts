import { setup, assign } from 'xstate';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import {
  getLastCreatedEpoch,
  getEpochsToCreate,
  createEpochs,
} from '@/src/xstate/epoch/epoch.actors.js';

export const epochCreationMachine = setup({
  types: {
    context: {} as {
      epochController: EpochController;
      lastEpoch: number | null;
      epochsToCreate: number[];
      slotDuration: number;
    },
    input: {} as {
      slotDuration: number;
      epochController: EpochController;
    },
  },
  actors: {
    getLastCreatedEpoch,
    getEpochsToCreate,
    createEpochs,
  },
  delays: {
    slotDuration: ({ context }) => {
      return context.slotDuration * 1000;
    },
  },
}).createMachine({
  id: 'EpochCreator',
  initial: 'readLastCreated',
  description: 'The epoch creator is a state machine that is responsible for creating epochs.',
  context: ({ input }) => ({
    epochController: input.epochController,
    lastEpoch: 0,
    epochsToCreate: [],
    slotDuration: input.slotDuration,
  }),
  states: {
    readLastCreated: {
      invoke: {
        src: 'getLastCreatedEpoch',
        input: ({ context }) => ({ epochController: context.epochController }),
        onDone: {
          target: 'getEpochsToCreate',
          actions: assign({ lastEpoch: ({ event }) => event.output }),
        },
        onError: 'sleep',
      },
    },
    getEpochsToCreate: {
      invoke: {
        src: 'getEpochsToCreate',
        input: ({ context }) => ({
          epochController: context.epochController,
          lastEpoch: context.lastEpoch,
        }),
        onDone: {
          target: 'createEpochs',
          actions: assign({ epochsToCreate: ({ event }) => event.output }),
        },
        onError: 'sleep',
      },
    },
    createEpochs: {
      invoke: {
        src: 'createEpochs',
        input: ({ context }) => ({
          epochController: context.epochController,
          epochsToCreate: context.epochsToCreate,
        }),
        onDone: 'sleep',
        onError: 'sleep',
      },
    },
    sleep: {
      after: {
        slotDuration: {
          target: 'readLastCreated',
          actions: assign({
            lastEpoch: 0,
            epochsToCreate: [],
          }),
        },
      },
    },
  },
});
