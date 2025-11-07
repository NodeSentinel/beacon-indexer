import { Epoch } from '@beacon-indexer/db';
import { setup, assign, stopChild, ActorRefFrom, fromPromise } from 'xstate';

import { epochProcessorMachine } from './epochProcessor.machine.js';

import type { CustomLogger } from '@/src/lib/pino.js';
import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { logActor } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The epoch orchestrator is a state machine that is responsible for orchestrating the processing of epochs.
 *
 * It is responsible for:
 * - Polling for the minimum unprocessed epoch
 * - Spawning the epoch processor machine when epoch data is available
 * - Monitoring epoch completion
 *
 * This machine processes one epoch at a time.
 *
 * States:
 * - pollingEpoch: Invokes getMinEpochToProcess and transitions based on result
 * - processingEpoch: Spawns epoch processor actor and handles completion
 * - idleNoEpoch: Waits when no epoch is available before polling again
 */

// TODO: make this machine to process N epochs at a time.

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
      validatorsController?: ValidatorsController;
      slotController: SlotController;
    };
    events: { type: 'EPOCH_COMPLETED'; machineId: string };
    input: {
      slotDuration: number;
      lookbackSlot: number;
      epochController: EpochController;
      beaconTime: BeaconTime;
      validatorsController?: ValidatorsController;
      slotController: SlotController;
    };
  },
  actors: {
    getMinEpochToProcess: fromPromise(
      async ({ input }: { input: { epochController: EpochController } }) => {
        return input.epochController.getMinEpochToProcess();
      },
    ),
    epochProcessorMachine,
  },
  guards: {
    hasEpochData: ({ context }) => {
      return context.epochData !== null;
    },
  },
  delays: {
    slotDuration: ({ context }) => context.slotDuration,
    noMinEpochDelay: ({ context }) => context.slotDuration / 3,
  },
}).createMachine({
  id: 'EpochOrchestrator',
  initial: 'pollingEpoch',
  context: ({ input }) => ({
    epochData: null,
    epochActor: null,
    slotDuration: input.slotDuration,
    lookbackSlot: input.lookbackSlot,
    epochController: input.epochController,
    beaconTime: input.beaconTime,
    validatorsController: input.validatorsController,
    slotController: input.slotController,
  }),
  states: {
    pollingEpoch: {
      invoke: {
        src: 'getMinEpochToProcess',
        input: ({ context }) => ({ epochController: context.epochController }),
        onDone: [
          {
            guard: ({ event }) => event.output !== null,
            target: 'processingEpoch',
            actions: [
              assign({
                epochData: ({ event }) => event.output,
              }),
              pinoLog(
                ({ event }) => `Found epoch ${event.output?.epoch} to process`,
                'EpochOrchestrator',
              ),
            ],
          },
          {
            target: 'idleNoEpoch',
            actions: pinoLog('No epoch to process, entering idle state', 'EpochOrchestrator'),
          },
        ],
        onError: {
          target: 'idleNoEpoch',
          actions: pinoLog(
            ({ event }) => `Error getting min epoch to process: ${event.error}`,
            'EpochOrchestrator',
            'error',
          ),
        },
      },
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
                epochDBSnapshot: {
                  validatorsBalancesFetched: context.epochData.validatorsBalancesFetched,
                  rewardsFetched: context.epochData.rewardsFetched,
                  committeesFetched: context.epochData.committeesFetched,
                  slotsFetched: context.epochData.allSlotsProcessed,
                  syncCommitteesFetched: context.epochData.syncCommitteesFetched,
                  validatorsActivationFetched: context.epochData.validatorsActivationFetched,
                },
                config: {
                  slotDuration: context.slotDuration,
                  lookbackSlot: context.lookbackSlot,
                },
                services: {
                  beaconTime: context.beaconTime,
                  epochController: context.epochController,
                  validatorsController: context.validatorsController,
                  slotController: context.slotController,
                },
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
          target: 'pollingEpoch',
          actions: [
            pinoLog(
              ({ event }) => `Epoch processing completed for ${event.machineId}`,
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

    idleNoEpoch: {
      entry: pinoLog('No epoch available, waiting before next poll', 'EpochOrchestrator'),
      after: {
        noMinEpochDelay: 'pollingEpoch',
      },
    },
  },
});
