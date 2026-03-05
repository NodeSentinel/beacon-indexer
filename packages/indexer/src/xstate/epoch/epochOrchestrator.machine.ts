import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import {
  setup,
  assign,
  stopChild,
  spawnChild,
  sendTo,
  fromPromise,
  and,
  ActorRefFrom,
} from 'xstate';

import { dailyArchiveMachine } from '../archive/dailyArchive.machine.js';
import { hourlyArchiveMachine } from '../archive/hourlyArchive.machine.js';
import { chainStatsMachine } from '../chainStats/chainStats.machine.js';

import { epochWorkerMachine } from './epochWorker.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { PartitionController } from '@/src/services/consensus/controllers/partition.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The epoch orchestrator manager is responsible for scheduling and managing parallel epoch processing.
 *
 * It is responsible for:
 * - Managing capacity (up to N epochs in parallel)
 * - Polling for unprocessed epochs (excluding active ones)
 * - Spawning worker machines for each epoch
 * - Monitoring epoch completion and refilling capacity in order
 *
 * This machine processes multiple epochs in parallel with polling-based status checking:
 * - Polls periodically to check epoch status and capacity
 * - Event handler only marks epochs as completed (doesn't trigger transitions)
 * - Explicit states for orchestrating with internal states for releasing, spawning, and polling
 *
 * States:
 * - orchestrating: Main state with internal states:
 *   - releasingCompletedEpochs: Removes completed epochs from active list
 *   - spawningEpochs: Queries and spawns new epoch workers (loops to itself if more capacity)
 *   - pollingDelay: Waits before checking again
 */

// Maximum number of epochs to process in parallel
const MAX_PARALLEL_EPOCHS = 3;

type EpochStatus = 'processing' | 'completed';

// Helper function to get consecutive completed epochs from the lowest
const getEpochsToRelease = (epochs: Record<number, EpochStatus>): number[] => {
  const activeEpochs = Object.keys(epochs)
    .map((e) => parseInt(e))
    .sort((a, b) => a - b);

  if (activeEpochs.length === 0) return [];

  const epochsToRelease: number[] = [];
  for (const epoch of activeEpochs) {
    if (epochs[epoch] === 'completed') {
      epochsToRelease.push(epoch);
    } else {
      break; // Stop at first non-completed epoch (ordered release)
    }
  }

  return epochsToRelease;
};

// Helper function to format queue state for logging
const formatQueueState = (epochs: Record<number, EpochStatus>): string => {
  const activeEpochs = Object.keys(epochs)
    .map((e) => parseInt(e))
    .sort((a, b) => a - b);

  if (activeEpochs.length === 0) return '[]';

  return `[${activeEpochs.map((e) => `${e}:${epochs[e]}`).join(', ')}]`;
};

export const epochOrchestratorMachine = setup({
  types: {} as {
    context: {
      // Active epochs tracking with status
      epochs: Record<number, EpochStatus>;
      // Hourly archive actor reference (passed from outside)
      hourlyArchiveActor: ActorRefFrom<typeof hourlyArchiveMachine>;
      // Daily archive actor reference (passed from outside)
      dailyArchiveActor: ActorRefFrom<typeof dailyArchiveMachine>;
      // Chain stats actor reference (passed from outside)
      chainStatsActor: ActorRefFrom<typeof chainStatsMachine>;
      // Config
      config: {
        slotDuration: number;
        slotsPerEpoch: number;
        lookbackSlot: number;
      };
      // Services
      services: {
        epochController: EpochController;
        partitionController: PartitionController;
        beaconTime: BeaconTime;
        validatorsController?: ValidatorsController;
        slotController: SlotController;
      };
    };
    events: { type: 'EPOCH_COMPLETED'; epoch: number; machineId: string };
    input: {
      slotDuration: number;
      slotsPerEpoch: number;
      lookbackSlot: number;
      epochController: EpochController;
      partitionController: PartitionController;
      beaconTime: BeaconTime;
      validatorsController?: ValidatorsController;
      slotController: SlotController;
      hourlyArchiveActor: ActorRefFrom<typeof hourlyArchiveMachine>;
      dailyArchiveActor: ActorRefFrom<typeof dailyArchiveMachine>;
      chainStatsActor: ActorRefFrom<typeof chainStatsMachine>;
    };
  },
  actors: {
    getMinEpochToProcessExcluding: fromPromise(
      async ({
        input,
      }: {
        input: { epochController: EpochController; activeEpochs: number[] };
      }) => {
        return input.epochController.getMinEpochToProcessExcluding(input.activeEpochs);
      },
    ),
    epochWorkerMachine,
  },
  guards: {
    hasEpochFound: ({ event }) => {
      return 'output' in event && event.output !== null;
    },
    hasCapacity: ({ context }) => {
      return Object.keys(context.epochs).length < MAX_PARALLEL_EPOCHS;
    },
  },
  delays: {
    pollingDelay: ({ context }) => context.config.slotDuration / 2,
  },
}).createMachine({
  id: 'EpochOrchestrator',
  initial: 'orchestrating',
  context: ({ input }) => ({
    epochs: {},
    hourlyArchiveActor: input.hourlyArchiveActor,
    dailyArchiveActor: input.dailyArchiveActor,
    chainStatsActor: input.chainStatsActor,
    config: {
      slotDuration: input.slotDuration,
      slotsPerEpoch: input.slotsPerEpoch,
      lookbackSlot: input.lookbackSlot,
    },
    services: {
      epochController: input.epochController,
      partitionController: input.partitionController,
      beaconTime: input.beaconTime,
      validatorsController: input.validatorsController,
      slotController: input.slotController,
    },
  }),
  states: {
    orchestrating: {
      initial: 'spawningEpochs',
      states: {
        releasingCompletedEpochs: {
          entry: [
            pinoLog(({ context }) => {
              const epochsToRelease = getEpochsToRelease(context.epochs);
              if (epochsToRelease.length) {
                return `Releasing epochs: [${epochsToRelease.join(', ')}]`;
              }
            }, 'EpochOrchestrator'),
            assign({
              epochs: ({ context }) => {
                const epochsToRelease = getEpochsToRelease(context.epochs);

                if (epochsToRelease.length === 0) return context.epochs;

                const updatedEpochs = { ...context.epochs };
                epochsToRelease.forEach((epoch) => {
                  delete updatedEpochs[epoch];
                });

                return updatedEpochs;
              },
            }),
            pinoLog(({ context }) => {
              return `Queue after dequeue: ${formatQueueState(context.epochs)}`;
            }, 'EpochOrchestrator'),
          ],
          after: {
            0: { target: 'spawningEpochs' },
          },
        },
        spawningEpochs: {
          invoke: {
            src: 'getMinEpochToProcessExcluding',
            input: ({ context }) => {
              const activeEpochs = Object.keys(context.epochs)
                .map((e) => parseInt(e))
                .sort((a, b) => a - b);
              return {
                epochController: context.services.epochController,
                activeEpochs,
              };
            },
            onDone: [
              {
                guard: and(['hasEpochFound', 'hasCapacity']),
                target: 'pollingDelay',
                actions: [
                  spawnChild('epochWorkerMachine', {
                    id: ({ event }) => {
                      const epoch = (event as unknown as { output: { epoch: number } }).output
                        .epoch;
                      return `epochWorker:${epoch}`;
                    },
                    input: ({ context, event }) => {
                      const epoch = (event as unknown as { output: { epoch: number } }).output
                        .epoch;
                      return {
                        epoch,
                        slotDuration: context.config.slotDuration,
                        slotsPerEpoch: context.config.slotsPerEpoch,
                        lookbackSlot: context.config.lookbackSlot,
                        epochController: context.services.epochController,
                        partitionController: context.services.partitionController,
                        beaconTime: context.services.beaconTime,
                        validatorsController: context.services.validatorsController,
                        slotController: context.services.slotController,
                      };
                    },
                  }),
                  assign({
                    epochs: ({ context, event }) => ({
                      ...context.epochs,
                      [event.output!.epoch]: 'processing' as EpochStatus,
                    }),
                  }),
                  pinoLog(
                    ({ event }) => `Spawned worker for epoch ${event.output!.epoch}`,
                    'EpochOrchestrator',
                  ),
                  pinoLog(({ context }) => {
                    return `Queue after enqueue: ${formatQueueState(context.epochs)}`;
                  }, 'EpochOrchestrator'),
                ],
              },
              {
                target: 'pollingDelay',
              },
            ],
            onError: {
              target: 'pollingDelay',
              actions: pinoLog(
                ({ event }) => `Error getting min epoch to process: ${event.error}`,
                'EpochOrchestrator',
                'error',
              ),
            },
          },
        },
        pollingDelay: {
          after: {
            pollingDelay: 'releasingCompletedEpochs',
          },
        },
      },
    },
  },
  on: {
    // Handle epoch completion from any state (global event handler)
    // Marks epoch as completed, stops the worker, and triggers hourly archive tick
    EPOCH_COMPLETED: {
      actions: [
        pinoLog(({ event }) => `Epoch ${event.epoch} completed`, 'EpochOrchestrator'),
        stopChild(({ event }) => `epochWorker:${event.epoch}`),
        assign({
          epochs: ({ context, event }) => {
            // Mark epoch as completed if it exists and is processing
            if (context.epochs[event.epoch] === 'processing') {
              return {
                ...context.epochs,
                [event.epoch]: 'completed' as EpochStatus,
              };
            }
            return context.epochs;
          },
        }),
        pinoLog(({ context }) => {
          return `Queue after epoch completed: ${formatQueueState(context.epochs)}`;
        }, 'EpochOrchestrator'),
        // Forward EPOCH_PROCESSED to hourly archive actor to trigger archive check
        sendTo(
          ({ context }) => context.hourlyArchiveActor,
          ({ event }) => ({ type: 'EPOCH_PROCESSED' as const, epoch: event.epoch }),
        ),
        // Forward EPOCH_PROCESSED to daily archive actor to trigger daily archive check
        sendTo(
          ({ context }) => context.dailyArchiveActor,
          ({ event }) => ({ type: 'EPOCH_PROCESSED' as const, epoch: event.epoch }),
        ),
        // Forward EPOCH_PROCESSED to chain stats actor to compute chain stats
        sendTo(
          ({ context }) => context.chainStatsActor,
          ({ event }) => ({ type: 'EPOCH_PROCESSED' as const, epoch: event.epoch }),
        ),
      ],
    },
  },
});
