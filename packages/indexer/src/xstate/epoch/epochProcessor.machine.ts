import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import ms from 'ms';
import { ActorRefFrom, assign, fromPromise, raise, sendParent, setup, stopChild } from 'xstate';

import { slotOrchestratorMachine, SlotsCompletedEvent } from '../slot/slotOrchestrator.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { monitoredState } from '@/src/xstate/monitoring/taskMonitor.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

export const epochProcessorMachine = setup({
  types: {} as {
    context: {
      epoch: number;
      startSlot: number;
      endSlot: number;
      // Sync state
      sync: {
        committeesFetched: boolean;
        syncCommitteesFetched: boolean;
        validatorsBalancesFetched: boolean;
      };
      // Config
      config: {
        slotDuration: number;
        slotsPerEpoch: number;
        lookbackSlot: number;
        maxParallelEpochs: number;
      };
      // Services
      services: {
        beaconTime: BeaconTime;
        epochController: EpochController;
        validatorsController?: ValidatorsController;
        slotController: SlotController;
      };
      // Actors
      actors: {
        slotOrchestratorActor?: ActorRefFrom<typeof slotOrchestratorMachine> | null;
      };
    };
    events:
      | {
          type: 'COMMITTEES_FETCHED';
        }
      | {
          type: 'SYNC_COMMITTEES_FETCHED';
        }
      | {
          type: 'VALIDATORS_BALANCES_FETCHED';
        }
      | {
          type: 'EPOCH_STARTED';
        }
      | SlotsCompletedEvent;
    input: {
      epoch: number;
      config: {
        slotDuration: number;
        slotsPerEpoch: number;
        lookbackSlot: number;
        maxParallelEpochs: number;
      };
      services: {
        beaconTime: BeaconTime;
        epochController: EpochController;
        validatorsController?: ValidatorsController;
        slotController: SlotController;
      };
    };
  },
  actors: {
    // Inline actors using the new controller methods
    fetchCommittees: fromPromise(
      async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
        await input.epochController.fetchCommittees(input.epoch);
      },
    ),
    fetchSyncCommittees: fromPromise(
      async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
        await input.epochController.fetchSyncCommittees(input.epoch);
      },
    ),
    fetchValidatorsState: fromPromise(
      async ({
        input,
      }: {
        input: {
          validatorsController: ValidatorsController;
          epochController: EpochController;
          startSlot: number;
          epoch: number;
        };
      }) => {
        // Check if validators balances are already fetched for this epoch
        const isFetched = await input.epochController.isValidatorsBalancesFetched(input.epoch);
        if (isFetched) {
          return;
        }

        await input.validatorsController.fetchValidatorsState(input.startSlot, input.epoch);
      },
    ),
    discoverNewValidators: fromPromise(
      async ({
        input,
      }: {
        input: {
          validatorsController: ValidatorsController;
          beaconTime: BeaconTime;
          epoch: number;
        };
      }) => {
        const { startSlot } = input.beaconTime.getEpochSlots(input.epoch);
        await input.validatorsController.discoverNewValidators(startSlot);
      },
    ),
    trackingTransitioningValidators: fromPromise(
      async ({
        input,
      }: {
        input: {
          validatorsController: ValidatorsController;
          epochController: EpochController;
          beaconTime: BeaconTime;
          markValidatorsActivationFetched: (epoch: number) => Promise<void>;
          epoch: number;
        };
      }) => {
        // Check if validators activation tracking is already done for this epoch
        const isFetched = await input.epochController.isValidatorsActivationFetched(input.epoch);
        if (isFetched) {
          return;
        }

        const { startSlot } = input.beaconTime.getEpochSlots(input.epoch);
        await input.validatorsController.trackTransitioningValidators(startSlot);
        await input.markValidatorsActivationFetched(input.epoch);
      },
    ),
    updateSlotsFetched: fromPromise(
      async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
        await input.epochController.updateSlotsFetched(input.epoch);
      },
    ),
    markEpochAsProcessed: fromPromise(
      async ({
        input,
      }: {
        input: { epochController: EpochController; epoch: number; machineId: string };
      }) => {
        await input.epochController.markEpochAsProcessed(input.epoch);
        return { success: true, machineId: input.machineId };
      },
    ),
    // Wait for epoch start using a single timeout
    waitForEpochStart: fromPromise(
      async ({ input }: { input: { beaconTime: BeaconTime; startSlot: number } }) => {
        await input.beaconTime.waitUntilSlotStart(input.startSlot);
      },
    ),
    // Wait until we can process an epoch (we can process epoch N when current epoch >= N-1)
    waitToProcessEpoch: fromPromise(
      async ({ input }: { input: { beaconTime: BeaconTime; epoch: number } }) => {
        // We can process epoch X when epoch X-1 has started
        // So we wait until epoch X-1 starts
        const prevEpoch = input.epoch - 1;
        const { startSlot } = input.beaconTime.getEpochSlots(prevEpoch);
        await input.beaconTime.waitUntilSlotStart(startSlot);
      },
    ),
    // Wait for epoch end
    waitForEpochEnd: fromPromise(
      async ({
        input,
      }: {
        input: { beaconTime: BeaconTime; endSlot: number; slotsPerEpoch: number };
      }) => {
        // Wait until the slot after the last slot of the epoch has started
        // Add one epoch worth of slots to ensure the epoch has fully ended
        await input.beaconTime.waitUntilSlotStart(input.endSlot + input.slotsPerEpoch);
      },
    ),
    // Fetch rewards after epoch has ended
    fetchAttestationsRewards: fromPromise(
      async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
        await input.epochController.fetchEpochRewards(input.epoch);
      },
    ),
    // Process slots with all prerequisites
    processSlots: fromPromise(
      async ({
        input,
      }: {
        input: {
          epoch: number;
          lookbackSlot: number;
          slotDuration: number;
          slotController: SlotController;
          epochController: EpochController;
          committeesReady: boolean;
        };
      }) => {
        // Ensure committees are ready
        if (!input.committeesReady) {
          throw new Error('Committees must be ready before processing slots');
        }

        // Return success - the actual slot orchestrator is spawned separately
        return { success: true };
      },
    ),
    checkPriorEpochCommittees: fromPromise(
      async ({
        input,
      }: {
        input: {
          epochController: EpochController;
          epoch: number;
          lookbackEpoch: number;
        };
      }) => {
        return input.epochController.isPriorEpochCommitteesReady(input.epoch, input.lookbackEpoch);
      },
    ),
    checkPriorEpochSlotsProcessed: fromPromise(
      async ({
        input,
      }: {
        input: {
          epochController: EpochController;
          epoch: number;
          epochsToCheckAmount: number;
          lookbackEpoch: number;
        };
      }) => {
        return input.epochController.isPriorEpochSlotsProcessed(
          input.epoch,
          input.epochsToCheckAmount,
          input.lookbackEpoch,
        );
      },
    ),
    slotOrchestratorMachine,
  },
  actions: {
    prefetchNextEpochCommittees: ({ context }) => {
      context.services.epochController.prefetchCommittees(context.epoch + 1);
    },
  },
  guards: {
    canProcessEpoch: ({ context }): boolean => {
      const currentEpoch = context.services.beaconTime.getEpochNumberFromTimestamp(Date.now());
      return context.epoch <= currentEpoch + 1;
    },
    hasEpochAlreadyStarted: ({ context }): boolean => {
      return context.services.beaconTime.hasSlotStarted(context.startSlot);
    },
    areCommitteesFetched: ({ context }): boolean => {
      return context.sync.committeesFetched === true && context.sync.syncCommitteesFetched === true;
    },
    areValidatorsBalancesFetched: ({ context }): boolean => {
      return context.sync.validatorsBalancesFetched === true;
    },
    hasEpochEnded: ({ context }): boolean => {
      return context.services.beaconTime.hasEpochEnded(context.epoch);
    },
    isPriorEpochCommitteesReady: ({ event }): boolean => {
      return 'output' in event && event.output === true;
    },
    isPriorEpochSlotsProcessed: ({ event }): boolean => {
      return 'output' in event && event.output === true;
    },
    canFetchRewards: ({ context }): boolean => {
      return (
        context.sync.validatorsBalancesFetched === true &&
        context.services.beaconTime.hasEpochEnded(context.epoch)
      );
    },
  },
  delays: {
    retryWait: ms('5s'),
    slotDurationHalf: ({ context }) => context.config.slotDuration / 2,
  },
}).createMachine({
  id: 'EpochProcessor',
  initial: 'waitingToProcessEpoch',
  context: ({ input }) => {
    const { endSlot, startSlot } = input.services.beaconTime.getEpochSlots(input.epoch);
    return {
      epoch: input.epoch,
      startSlot: startSlot,
      endSlot: endSlot,
      sync: {
        committeesFetched: false,
        syncCommitteesFetched: false,
        validatorsBalancesFetched: false,
      },
      config: input.config,
      services: input.services,
      actors: {
        slotOrchestratorActor: null,
      },
    };
  },
  states: {
    waitingToProcessEpoch: {
      description:
        'Waiting for the epoch to be ready. Uses beaconTime to calculate exact wait time.',
      entry: pinoLog(
        ({ context }) => `Waiting to process epoch ${context.epoch}`,
        'EpochProcessor',
      ),
      invoke: {
        src: 'waitToProcessEpoch',
        input: ({ context }) => ({
          beaconTime: context.services.beaconTime,
          epoch: context.epoch,
        }),
        onDone: {
          target: 'epochProcessing',
        },
        onError: {
          actions: pinoLog(
            ({ context, event }) =>
              `error waiting to process epoch ${context.epoch}: ${event.error}`,
            'EpochProcessor',
            'error',
          ),
        },
      },
    },
    epochProcessing: monitoredState('epoch', {
      description:
        'processing beacon epoch data. Note that data can be processed at different times, some 1 epoch ahead and some after the epoch started.',
      entry: [
        pinoLog(
          ({ context }) => `Starting epoch processing for epoch ${context.epoch}`,
          'EpochProcessor',
        ),
      ],
      type: 'parallel',
      states: {
        monitoringEpochStart: {
          description: 'Wait for the epoch to start and send the EPOCH_STARTED event',
          initial: 'checkingIfEpochAlreadyStarted',
          states: {
            checkingIfEpochAlreadyStarted: {
              after: {
                0: [
                  {
                    guard: 'hasEpochAlreadyStarted',
                    target: 'epochStarted',
                  },
                  {
                    target: 'waitingForEpochStart',
                  },
                ],
              },
            },
            waitingForEpochStart: {
              entry: pinoLog(
                ({ context }) => `Waiting for epoch ${context.epoch} to start`,
                'EpochProcessor:monitoringEpochStart',
              ),
              invoke: {
                src: 'waitForEpochStart',
                input: ({ context }) => ({
                  beaconTime: context.services.beaconTime,
                  startSlot: context.startSlot,
                }),
                onDone: {
                  target: 'epochStarted',
                },
                onError: {
                  actions: pinoLog(
                    ({ context, event }) =>
                      `error waiting for epoch ${context.epoch} to start: ${event.error}`,
                    'EpochProcessor:monitoringEpochStart',
                    'error',
                  ),
                },
              },
            },
            epochStarted: {
              type: 'final',
              entry: [
                raise({ type: 'EPOCH_STARTED' }),
                pinoLog(
                  ({ context }) => `Epoch ${context.epoch} started`,
                  'EpochProcessor:monitoringEpochStart',
                ),
              ],
            },
          },
        },
        fetching: {
          description: 'Fetching data from the epoch',
          type: 'parallel',
          states: {
            committees: {
              description:
                'Get epoch committees, create the slots if they do not exist. Raise COMMITTEES_FETCHED event when done.',
              initial: 'fetchingCommittees',
              states: {
                fetchingCommittees: monitoredState('fetch committees', {
                  entry: [
                    'prefetchNextEpochCommittees',
                    pinoLog(
                      ({ context }) => `Processing committees for epoch ${context.epoch}`,
                      'EpochProcessor:committees',
                    ),
                  ],
                  invoke: {
                    src: 'fetchCommittees',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'committeesFetched',
                    },
                    onError: {
                      target: 'waitingRetry',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error processing committees for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:committees',
                        'error',
                      ),
                    },
                  },
                }),
                waitingRetry: {
                  after: {
                    retryWait: 'fetchingCommittees',
                  },
                },
                committeesFetched: {
                  type: 'final',
                  entry: [
                    assign({
                      sync: ({ context }) => ({
                        ...context.sync,
                        committeesFetched: true,
                      }),
                    }),
                    raise({ type: 'COMMITTEES_FETCHED' }),
                    pinoLog(
                      ({ context }) => `Committees done for epoch ${context.epoch}`,
                      'EpochProcessor:committees',
                    ),
                  ],
                },
              },
            },
            syncingCommittees: {
              description:
                'Get the sync committees for the epoch, it might be the case that they are already fetched, as the same committee last 256 epochs.',
              initial: 'fetchingSyncCommittees',
              states: {
                fetchingSyncCommittees: monitoredState('fetch sync committees', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing sync committees for epoch ${context.epoch}`,
                      'EpochProcessor:syncingCommittees',
                    ),
                  ],
                  invoke: {
                    src: 'fetchSyncCommittees',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'syncCommitteesFetched',
                    },
                    onError: {
                      target: 'waitingRetry',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error processing sync committees for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:syncingCommittees',
                        'error',
                      ),
                    },
                  },
                }),
                waitingRetry: {
                  after: {
                    retryWait: 'fetchingSyncCommittees',
                  },
                },
                syncCommitteesFetched: {
                  type: 'final',
                  entry: [
                    assign({
                      sync: ({ context }) => ({
                        ...context.sync,
                        syncCommitteesFetched: true,
                      }),
                    }),
                    raise({ type: 'SYNC_COMMITTEES_FETCHED' }),
                    pinoLog(
                      ({ context }) => `Sync committees done for epoch ${context.epoch}`,
                      'EpochProcessor:syncingCommittees',
                    ),
                  ],
                },
              },
            },
            slotsProcessing: {
              description: 'Process slots for the epoch. Waits for committees to be ready.',
              initial: 'waitingForPriorEpochDependencies',
              states: {
                waitingForPriorEpochDependencies: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for prior epoch dependencies before processing epoch ${context.epoch}`,
                    'EpochProcessor:slotsProcessing',
                  ),
                  invoke: {
                    src: 'checkPriorEpochCommittees',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                      lookbackEpoch: context.services.beaconTime.getEpochFromSlot(
                        context.config.lookbackSlot,
                      ),
                    }),
                    onDone: [
                      {
                        guard: 'isPriorEpochCommitteesReady',
                        target: 'waitingForCommittees',
                      },
                      {
                        target: 'retryingPriorEpochDependencies',
                      },
                    ],
                    onError: {
                      target: 'retryingPriorEpochDependencies',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error checking prior epoch dependencies for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:slotsProcessing',
                        'error',
                      ),
                    },
                  },
                },
                retryingPriorEpochDependencies: {
                  after: {
                    slotDurationHalf: 'waitingForPriorEpochDependencies',
                  },
                },
                waitingForCommittees: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Prior epoch committees ready. Waiting for current epoch committees for epoch ${context.epoch}`,
                    'EpochProcessor:slotsProcessing',
                  ),
                  after: {
                    0: {
                      guard: 'areCommitteesFetched',
                      target: 'waitingForPriorEpochSlots',
                    },
                  },
                  on: {
                    COMMITTEES_FETCHED: {
                      guard: 'areCommitteesFetched',
                      target: 'waitingForPriorEpochSlots',
                    },
                    SYNC_COMMITTEES_FETCHED: {
                      guard: 'areCommitteesFetched',
                      target: 'waitingForPriorEpochSlots',
                    },
                  },
                },
                waitingForPriorEpochSlots: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for prior epoch slots to be processed before processing epoch ${context.epoch}`,
                    'EpochProcessor:slotsProcessing',
                  ),
                  invoke: {
                    src: 'checkPriorEpochSlotsProcessed',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                      epochsToCheckAmount: context.config.maxParallelEpochs - 1,
                      lookbackEpoch: context.services.beaconTime.getEpochFromSlot(
                        context.config.lookbackSlot,
                      ),
                    }),
                    onDone: [
                      {
                        guard: 'isPriorEpochSlotsProcessed',
                        target: 'runningSlotsOrchestrator',
                      },
                      {
                        target: 'retryingPriorEpochSlots',
                      },
                    ],
                    onError: {
                      target: 'retryingPriorEpochSlots',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error checking prior epoch slots for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:slotsProcessing',
                        'error',
                      ),
                    },
                  },
                },
                retryingPriorEpochSlots: {
                  after: {
                    slotDurationHalf: 'waitingForPriorEpochSlots',
                  },
                },
                runningSlotsOrchestrator: monitoredState('process slots', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing slots for epoch ${context.epoch}`,
                      'EpochProcessor:slotsProcessing',
                    ),
                    assign({
                      actors: ({ context, spawn }) => {
                        const orchestratorId = `slotOrchestrator:${context.epoch}`;

                        const actor = spawn('slotOrchestratorMachine', {
                          id: orchestratorId,
                          input: {
                            epoch: context.epoch,
                            lookbackSlot: context.config.lookbackSlot,
                            slotController: context.services.slotController,
                            slotDuration: context.config.slotDuration,
                          },
                        });

                        return {
                          ...context.actors,
                          slotOrchestratorActor: actor,
                        };
                      },
                    }),
                  ],
                  on: {
                    SLOTS_COMPLETED: {
                      target: 'updatingSlotsFetched',
                      actions: [
                        stopChild(({ context }) => context.actors.slotOrchestratorActor?.id || ''),
                        assign({
                          actors: ({ context }) => ({
                            ...context.actors,
                            slotOrchestratorActor: null,
                          }),
                        }),
                      ],
                    },
                  },
                }),
                updatingSlotsFetched: monitoredState('update slots fetched', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Updating slots fetched for epoch ${context.epoch}`,
                      'EpochProcessor:slotsProcessing',
                    ),
                  ],
                  invoke: {
                    src: 'updateSlotsFetched',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'slotsProcessed',
                    },
                    onError: {
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error updating slots fetched for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:slotsProcessing',
                        'error',
                      ),
                    },
                  },
                }),
                slotsProcessed: {
                  type: 'final',
                  entry: [
                    pinoLog(
                      ({ context }) => `Slots processed for epoch ${context.epoch}`,
                      'EpochProcessor:slotsProcessing',
                    ),
                  ],
                },
              },
            },
            trackingValidatorsActivation: {
              description: 'Discover new validators and track those transitioning between states',
              initial: 'waitingForEpochStart',
              states: {
                waitingForEpochStart: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for epoch to start before tracking validators for epoch ${context.epoch}`,
                    'EpochProcessor:trackingValidatorsActivation',
                  ),
                  on: {
                    EPOCH_STARTED: {
                      target: 'discoveringNewValidators',
                    },
                  },
                },
                discoveringNewValidators: monitoredState('discover validators', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Discovering new validators for epoch ${context.epoch}`,
                      'EpochProcessor:trackingValidatorsActivation',
                    ),
                  ],
                  invoke: {
                    src: 'discoverNewValidators',
                    input: ({ context }) => ({
                      validatorsController: context.services.validatorsController!,
                      beaconTime: context.services.beaconTime,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'trackingActivation',
                    },
                    onError: {
                      target: 'trackingActivation',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error discovering new validators for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:trackingValidatorsActivation',
                        'error',
                      ),
                    },
                  },
                }),
                trackingActivation: monitoredState('track validators activation', {
                  entry: [
                    pinoLog(
                      ({ context }) =>
                        `Processing validators activation for epoch ${context.epoch}`,
                      'EpochProcessor:trackingValidatorsActivation',
                    ),
                  ],
                  invoke: {
                    src: 'trackingTransitioningValidators',
                    input: ({ context }) => ({
                      markValidatorsActivationFetched: (epoch: number) =>
                        context.services.epochController.markValidatorsActivationFetched(epoch),
                      epoch: context.epoch,
                      validatorsController: context.services.validatorsController!,
                      epochController: context.services.epochController,
                      beaconTime: context.services.beaconTime,
                    }),
                    onDone: {
                      target: 'activationTracked',
                    },
                    onError: {
                      target: 'waitingRetry',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error processing validators activation for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:trackingValidatorsActivation',
                        'error',
                      ),
                    },
                  },
                }),
                waitingRetry: {
                  after: {
                    retryWait: 'trackingActivation',
                  },
                },
                activationTracked: {
                  type: 'final',
                  entry: [
                    pinoLog(
                      ({ context }) =>
                        `Tracking validators activation done for epoch ${context.epoch}`,
                      'EpochProcessor:trackingValidatorsActivation',
                    ),
                  ],
                },
              },
            },
            validatorsBalances: {
              description: 'Fetch validators balances for the epoch',
              initial: 'waitingForEpochStart',
              states: {
                waitingForEpochStart: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for epoch to start before fetching validators balances for epoch ${context.epoch}`,
                    'EpochProcessor:validatorsBalances',
                  ),
                  on: {
                    EPOCH_STARTED: {
                      target: 'fetchingValidatorsBalances',
                    },
                  },
                },
                fetchingValidatorsBalances: monitoredState('fetch validators', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing validators balances for epoch ${context.epoch}`,
                      'EpochProcessor:validatorsBalances',
                    ),
                  ],
                  invoke: {
                    src: 'fetchValidatorsState',
                    input: ({ context }) => ({
                      validatorsController: context.services.validatorsController!,
                      epochController: context.services.epochController,
                      startSlot: context.startSlot,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'validatorsBalancesFetched',
                    },
                    onError: {
                      target: 'waitingRetry',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error processing validators balances for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:validatorsBalances',
                        'error',
                      ),
                    },
                  },
                }),
                waitingRetry: {
                  after: {
                    retryWait: 'fetchingValidatorsBalances',
                  },
                },
                validatorsBalancesFetched: {
                  type: 'final',
                  entry: [
                    assign({
                      sync: ({ context }) => ({
                        ...context.sync,
                        validatorsBalancesFetched: true,
                      }),
                    }),
                    raise({ type: 'VALIDATORS_BALANCES_FETCHED' }),
                    pinoLog(
                      ({ context }) => `Validators balances done for epoch ${context.epoch}`,
                      'EpochProcessor:validatorsBalances',
                    ),
                  ],
                },
              },
            },
            rewards: {
              description: 'Fetch rewards after balances and the epoch has ended',
              initial: 'waitingForBalances',
              states: {
                waitingForBalances: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for validators balances before fetching rewards for epoch ${context.epoch}`,
                    'EpochProcessor:rewards',
                  ),
                  after: {
                    0: {
                      guard: 'areValidatorsBalancesFetched',
                      target: 'waitingForEpochEnd',
                    },
                  },
                  on: {
                    VALIDATORS_BALANCES_FETCHED: {
                      target: 'waitingForEpochEnd',
                    },
                  },
                },
                waitingForEpochEnd: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for epoch ${context.epoch} to end before fetching rewards`,
                    'EpochProcessor:rewards',
                  ),
                  invoke: {
                    src: 'waitForEpochEnd',
                    input: ({ context }) => ({
                      beaconTime: context.services.beaconTime,
                      endSlot: context.endSlot,
                      slotsPerEpoch: context.config.slotsPerEpoch,
                    }),
                    onDone: {
                      target: 'fetchingRewards',
                    },
                    onError: {
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error waiting for epoch ${context.epoch} to end: ${event.error}`,
                        'EpochProcessor:rewards',
                        'error',
                      ),
                    },
                  },
                },
                fetchingRewards: monitoredState('fetch rewards', {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing rewards for epoch ${context.epoch}`,
                      'EpochProcessor:rewards',
                    ),
                  ],
                  invoke: {
                    src: 'fetchAttestationsRewards',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'rewardsFetched',
                    },
                    onError: {
                      target: 'waitingRetry',
                      actions: pinoLog(
                        ({ context, event }) =>
                          `error processing rewards for epoch ${context.epoch}: ${event.error}`,
                        'EpochProcessor:rewards',
                        'error',
                      ),
                    },
                  },
                }),
                waitingRetry: {
                  after: {
                    retryWait: 'fetchingRewards',
                  },
                },
                rewardsFetched: {
                  type: 'final',
                  entry: [
                    pinoLog(
                      ({ context }) => `Rewards done for epoch ${context.epoch}`,
                      'EpochProcessor:rewards',
                    ),
                  ],
                },
              },
            },
          },
        },
      },
      onDone: 'markingEpochProcessed',
    }),
    markingEpochProcessed: monitoredState('mark epoch processed', {
      // TODO: we should check all the flags are set to true before marking the epoch as processed
      invoke: {
        src: 'markEpochAsProcessed',
        input: ({ context }) => ({
          epochController: context.services.epochController,
          epoch: context.epoch,
          machineId: `epochProcessor:${context.epoch}`,
        }),
        onDone: {
          target: 'epochCompleted',
          actions: [
            pinoLog(
              ({ context }) => `Epoch ${context.epoch} marked as processed`,
              'EpochProcessor',
            ),
            sendParent(({ context }) => ({
              type: 'EPOCH_COMPLETED',
              machineId: `epochProcessor:${context.epoch}`,
            })),
          ],
        },
        onError: {
          actions: pinoLog(
            ({ context, event }) =>
              `error marking epoch ${context.epoch} as processed: ${event.error}`,
            'EpochProcessor',
            'error',
          ),
        },
      },
    }),
    epochCompleted: {
      type: 'final',
    },
  },
});
