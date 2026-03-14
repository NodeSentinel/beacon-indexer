import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { setup, assign, sendParent, ActorRefFrom, fromPromise } from 'xstate';

import { epochProcessorMachine } from './epochProcessor.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { logActor } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';
import { sendTelegramError } from '@/src/xstate/telegramAlert.js';

/**
 * @fileoverview The epoch worker is a state machine responsible for processing a single epoch.
 *
 * It handles:
 * - Creating table partitions for the epoch
 * - Spawning the epoch processor machine
 * - Forwarding completion events to the parent manager
 *
 * This machine is spawned by the epoch orchestrator manager for each epoch to process.
 */

export const epochWorkerMachine = setup({
  types: {} as {
    context: {
      epoch: number;
      epochActor: ActorRefFrom<typeof epochProcessorMachine> | null;
      slotDuration: number;
      slotsPerEpoch: number;
      lookbackSlot: number;
      epochController: EpochController;
      partitionController: PartitionController;
      beaconTime: BeaconTime;
      validatorsController?: ValidatorsController;
      slotController: SlotController;
    };
    events: { type: 'EPOCH_COMPLETED'; machineId: string };
    input: {
      epoch: number;
      slotDuration: number;
      slotsPerEpoch: number;
      lookbackSlot: number;
      epochController: EpochController;
      partitionController: PartitionController;
      beaconTime: BeaconTime;
      validatorsController?: ValidatorsController;
      slotController: SlotController;
    };
  },
  actors: {
    createPartitionsForTables: fromPromise(
      async ({ input }: { input: { partitionController: PartitionController; epoch: number } }) => {
        await input.partitionController.createPartitionsToProcessEpoch(input.epoch);
      },
    ),
    epochProcessorMachine,
  },
  delays: {},
}).createMachine({
  id: 'EpochWorker',
  initial: 'creatingPartitions',
  context: ({ input }) => ({
    epoch: input.epoch,
    epochActor: null,
    slotDuration: input.slotDuration,
    slotsPerEpoch: input.slotsPerEpoch,
    lookbackSlot: input.lookbackSlot,
    epochController: input.epochController,
    partitionController: input.partitionController,
    beaconTime: input.beaconTime,
    validatorsController: input.validatorsController,
    slotController: input.slotController,
  }),
  states: {
    creatingPartitions: {
      entry: pinoLog(
        ({ context }) =>
          `Ensuring tables partitions for epoch ${context.epoch} exist before processing`,
        'EpochWorker',
      ),
      invoke: {
        src: 'createPartitionsForTables',
        input: ({ context }) => ({
          partitionController: context.partitionController,
          epoch: context.epoch,
        }),
        onDone: {
          target: 'runningProcessor',
          actions: pinoLog(
            ({ context }) => `Partitions ensured for epoch ${context.epoch}`,
            'EpochWorker',
          ),
        },
        onError: {
          target: 'failed',
          actions: [
            pinoLog(
              ({ context, event }) =>
                `Error ensuring partitions for epoch ${context.epoch}: ${event.error}`,
              'EpochWorker',
              'error',
            ),
            sendTelegramError(
              ({ context, event }) =>
                `Error ensuring partitions for epoch ${context.epoch}: ${event.error}`,
              'EpochWorker',
            ),
          ],
        },
      },
    },
    runningProcessor: {
      entry: [
        assign({
          epochActor: ({ context, spawn }) => {
            const epochId = `epochProcessor:${context.epoch}`;

            const actor = spawn('epochProcessorMachine', {
              id: epochId,
              input: {
                epoch: context.epoch,
                config: {
                  slotDuration: context.slotDuration,
                  slotsPerEpoch: context.slotsPerEpoch,
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
        pinoLog(({ context }) => `Processing epoch ${context.epoch}`, 'EpochWorker'),
      ],
    },
    completed: {
      type: 'final',
    },
    failed: {
      type: 'final',
      entry: pinoLog(
        ({ context }) => `Worker for epoch ${context.epoch} failed and will be retried later`,
        'EpochWorker',
        'error',
      ),
    },
  },
  on: {
    // Listen for completion from epochProcessorMachine and forward to parent manager
    EPOCH_COMPLETED: {
      target: '.completed',
      actions: [
        assign({
          epochActor: null,
        }),
        pinoLog(({ context }) => `Epoch ${context.epoch} processing completed`, 'EpochWorker'),
        sendParent(({ context, event }) => ({
          type: 'EPOCH_COMPLETED',
          epoch: context.epoch,
          machineId: event.machineId,
        })),
      ],
    },
  },
});
