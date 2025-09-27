import { Epoch } from '@beacon-indexer/db';
import ms from 'ms';
import { setup, assign, stopChild, ActorRefFrom } from 'xstate';

import { getMinEpochToProcess } from './epoch.actors.js';
import { epochProcessorMachine } from './epochProcessor.machine.js';

import type { CustomLogger } from '@/src/lib/pino.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { logActor } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The epoch orchestrator is a state machine that is responsible for orchestrating the processing of epochs.
 *
 * It is responsible for:
 * - Fetching the minimum unprocessed epoch
 * - Spawning the epoch processor machine
 * - Monitoring epoch completion
 *
 * This machine processes one epoch at a time.
 */

export const epochOrchestratorMachine = setup({
  types: {} as {
    context: {
      epochData: Epoch | null;
      epochActor: ActorRefFrom<typeof epochProcessorMachine> | null;
      logger?: CustomLogger;
      slotDuration: number;
      lookbackSlot: number;
      epochController: EpochController;
      beaconTime: BeaconTime;
    };
    events: { type: 'EPOCH_COMPLETED'; machineId: string };
    input: {
      slotDuration: number;
      lookbackSlot: number;
      epochController: EpochController;
      beaconTime: BeaconTime;
    };
  },
  actors: {
    getMinEpochToProcess,
    epochProcessorMachine,
  },
  guards: {
    hasEpochDataInContext: ({ context }) => {
      return context.epochData !== null;
    },
  },
  delays: {
    slotDuration: ({ context }) => ms(`${context.slotDuration}s`),
    noMinEpochDelay: ({ context }) => ms(`${context.slotDuration / 3}s`),
  },
}).createMachine({
  id: 'EpochOrchestrator',
  initial: 'gettingMinEpoch',
  context: ({ input }) => ({
    epochData: null,
    epochActor: null,
    slotDuration: input.slotDuration,
    lookbackSlot: input.lookbackSlot,
    epochController: input.epochController,
    beaconTime: input.beaconTime,
  }),
  states: {
    gettingMinEpoch: {
      invoke: {
        src: 'getMinEpochToProcess',
        input: ({ context }) => ({ epochController: context.epochController }),
        onDone: {
          target: 'checkingIfCanSpawnEpochProcessor',
          actions: [
            assign({
              epochData: ({ event }) => event.output,
            }),
            pinoLog(
              ({ event }) => `Start processing epoch ${event.output?.epoch}`,
              'EpochOrchestrator',
            ),
          ],
        },
        onError: {
          target: 'noMinEpochToProcess',
          actions: pinoLog(
            ({ event }) => `Error getting min epoch to process: ${event.error}`,
            'EpochOrchestrator',
            'error',
          ),
        },
      },
    },

    checkingIfCanSpawnEpochProcessor: {
      always: [
        {
          guard: 'hasEpochDataInContext',
          target: 'processingEpoch',
        },
        {
          target: 'noMinEpochToProcess',
        },
      ],
    },

    processingEpoch: {
      entry: [
        assign({
          epochActor: ({ context, spawn }) => {
            if (!context.epochData) return null;

            const { epoch } = context.epochData;
            const epochId = `epochProcessor:${epoch}`;

            const actor = spawn('epochProcessorMachine', {
              id: epochId,
              input: {
                epoch,
                validatorsBalancesFetched: context.epochData.validatorsBalancesFetched,
                rewardsFetched: context.epochData.rewardsFetched,
                committeesFetched: context.epochData.committeesFetched,
                slotsFetched: context.epochData.slotsFetched,
                syncCommitteesFetched: context.epochData.syncCommitteesFetched,
                validatorsActivationFetched: context.epochData.validatorsActivationFetched,
                slotDuration: context.slotDuration,
                lookbackSlot: context.lookbackSlot,
                beaconTime: context.beaconTime,
              },
            });

            logActor(actor, epochId);

            return actor;
          },
        }),
        pinoLog(
          ({ context }) => `Processing epoch ${context.epochData?.epoch}`,
          'EpochOrchestrator',
        ),
      ],
      on: {
        EPOCH_COMPLETED: {
          target: 'gettingMinEpoch',
          actions: [
            pinoLog(
              ({ event }) => `Epoch processing completed for epoch ${event.machineId}`,
              'EpochOrchestrator',
            ),
            stopChild(({ event }) => event.machineId),
            assign({
              epochData: null,
              epochActor: null,
            }),
          ],
        },
      },
    },

    noMinEpochToProcess: {
      entry: pinoLog(`No min epoch to process, waiting for next check`, 'EpochOrchestrator'),
      after: {
        noMinEpochDelay: 'gettingMinEpoch',
      },
    },
  },
});
