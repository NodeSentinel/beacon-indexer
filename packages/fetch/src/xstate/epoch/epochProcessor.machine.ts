import { setup, assign, sendParent, stopChild, raise, ActorRefFrom, fromPromise } from 'xstate';

import { slotOrchestratorMachine, SlotsCompletedEvent } from '../slot/slotOrchestrator.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorsController } from '@/src/services/consensus/controllers/validators.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import { logActor } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

export const epochProcessorMachine = setup({
  types: {} as {
    context: {
      epoch: number;
      startSlot: number;
      endSlot: number;
      // Flags to track completion state
      epochStarted: boolean;
      committeesReady: boolean;
      syncCommitteesReady: boolean;
      balancesReady: boolean;
      validatorsActivationReady: boolean;
      slotsReady: boolean;
      rewardsReady: boolean;
      config: {
        slotDuration: number;
        lookbackSlot: number;
      };
      services: {
        beaconTime: BeaconTime;
        epochController: EpochController;
        validatorsController?: ValidatorsController;
        slotController: SlotController;
      };
      actors: {
        slotOrchestratorActor?: ActorRefFrom<typeof slotOrchestratorMachine> | null;
      };
    };
    events:
      | {
          type: 'COMMITTEES_FETCHED';
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
      epochDBSnapshot: {
        validatorsBalancesFetched: boolean;
        rewardsFetched: boolean;
        committeesFetched: boolean;
        slotsFetched: boolean;
        syncCommitteesFetched: boolean;
        validatorsActivationFetched: boolean;
      };
      config: {
        slotDuration: number;
        lookbackSlot: number;
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
    fetchValidatorsBalances: fromPromise(
      async ({
        input,
      }: {
        input: {
          validatorsController: ValidatorsController;
          startSlot: number;
          epoch: number;
        };
      }) => {
        await input.validatorsController.fetchValidatorsBalances(input.startSlot, input.epoch);
      },
    ),
    fetchAttestationsRewards: fromPromise(
      async ({ input }: { input: { epochController: EpochController; epoch: number } }) => {
        await input.epochController.fetchRewards(input.epoch);
      },
    ),
    trackingTransitioningValidators: fromPromise(
      async ({
        input,
      }: {
        input: {
          validatorsController: ValidatorsController;
          markValidatorsActivationFetched: (epoch: number) => Promise<void>;
          epoch: number;
        };
      }) => {
        await input.validatorsController.trackTransitioningValidators();
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
      async ({
        input,
      }: {
        input: { beaconTime: BeaconTime; startSlot: number; slotDuration: number };
      }) => {
        const startTimestamp = input.beaconTime.getTimestampFromSlotNumber(input.startSlot);
        const now = Date.now();
        const delay = Math.max(0, startTimestamp - now);

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        return { success: true };
      },
    ),
    // Wait for epoch end and balances, then fetch rewards
    fetchRewardsAfterPrerequisites: fromPromise(
      async ({
        input,
      }: {
        input: {
          epochController: EpochController;
          beaconTime: BeaconTime;
          epoch: number;
          endSlot: number;
          balancesReady: boolean;
        };
      }) => {
        // Wait for balances if not ready (this should already be true by the time we invoke this)
        // But we'll add a safeguard anyway
        if (!input.balancesReady) {
          throw new Error('Balances must be ready before fetching rewards');
        }

        // Wait for epoch end
        const endTimestamp = input.beaconTime.getTimestampFromSlotNumber(input.endSlot + 1);
        const now = Date.now();
        const delay = Math.max(0, endTimestamp - now);

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Fetch rewards
        await input.epochController.fetchRewards(input.epoch);
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
    slotOrchestratorMachine,
  },
  guards: {
    canProcessEpoch: ({ context }): boolean => {
      const currentEpoch = context.services.beaconTime.getEpochNumberFromTimestamp(Date.now());
      return context.epoch <= currentEpoch + 1;
    },
    hasEpochAlreadyStarted: ({ context }): boolean => {
      const currentSlot = context.services.beaconTime.getSlotNumberFromTimestamp(Date.now());
      return currentSlot >= context.startSlot;
    },
  },
  delays: {
    slotDurationHalf: ({ context }) => context.config.slotDuration / 2,
  },
}).createMachine({
  id: 'EpochProcessor',
  initial: 'checkingCanProcess',
  context: ({ input }) => {
    const { startSlot, endSlot } = input.services.beaconTime.getEpochSlots(input.epoch);
    return {
      epoch: input.epoch,
      startSlot: startSlot,
      endSlot: endSlot,
      // Initialize flags from epochDBSnapshot
      epochStarted: false,
      committeesReady: input.epochDBSnapshot.committeesFetched,
      syncCommitteesReady: input.epochDBSnapshot.syncCommitteesFetched,
      balancesReady: input.epochDBSnapshot.validatorsBalancesFetched,
      validatorsActivationReady: input.epochDBSnapshot.validatorsActivationFetched,
      slotsReady: input.epochDBSnapshot.slotsFetched,
      rewardsReady: input.epochDBSnapshot.rewardsFetched,
      config: input.config,
      services: input.services,
      actors: {
        slotOrchestratorActor: null,
      },
    };
  },
  states: {
    checkingCanProcess: {
      entry: [
        pinoLog(
          ({ context }) => `Checking if we can process the epoch, ${context.epoch}`,
          'EpochProcessor',
        ),
      ],
      description:
        'Check if we can start processing the epoch, we can fetch some data one epoch ahead.',
      after: {
        0: [
          {
            guard: 'canProcessEpoch',
            target: 'epochProcessing',
          },
          {
            target: 'waiting',
          },
        ],
      },
    },
    waiting: {
      entry: pinoLog(
        ({ context }) => `Waiting to start processing epoch ${context.epoch}`,
        'EpochProcessor',
      ),
      after: {
        slotDurationHalf: 'checkingCanProcess',
      },
    },
    epochProcessing: {
      description: 'Epoch data can be processed at different times',
      entry: pinoLog(
        ({ context }) => `Starting epoch processing for epoch ${context.epoch}`,
        'EpochProcessor',
      ),
      type: 'parallel',
      states: {
        monitoringEpochStart: {
          description: 'Wait for the epoch to start and send the EPOCH_STARTED event',
          initial: 'checking',
          states: {
            checking: {
              always: [
                {
                  guard: 'hasEpochAlreadyStarted',
                  target: 'complete',
                },
                {
                  target: 'waiting',
                },
              ],
            },
            waiting: {
              entry: pinoLog(
                ({ context }) => `Waiting for epoch ${context.epoch} to start`,
                'EpochProcessor:monitoringEpochStart',
              ),
              invoke: {
                src: 'waitForEpochStart',
                input: ({ context }) => ({
                  beaconTime: context.services.beaconTime,
                  startSlot: context.startSlot,
                  slotDuration: context.config.slotDuration,
                }),
                onDone: {
                  target: 'complete',
                },
              },
            },
            complete: {
              type: 'final',
              entry: [
                assign({
                  epochStarted: true,
                }),
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
          description: 'Fetching data for the epoch',
          type: 'parallel',
          states: {
            committees: {
              description: 'Get epoch committees, create the slots if they are not in the database',
              initial: 'processing',
              states: {
                processing: {
                  entry: pinoLog(
                    ({ context }) => `Processing committees for epoch ${context.epoch}`,
                    'EpochProcessor:committees',
                  ),
                  invoke: {
                    src: 'fetchCommittees',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      committeesReady: true,
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
              description: 'Get sync committees for the epoch',
              initial: 'processing',
              states: {
                processing: {
                  entry: pinoLog(
                    ({ context }) => `Processing sync committees for epoch ${context.epoch}`,
                    'EpochProcessor:syncingCommittees',
                  ),
                  invoke: {
                    src: 'fetchSyncCommittees',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      syncCommitteesReady: true,
                    }),
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
              initial: 'waitingForCommittees',
              states: {
                waitingForCommittees: {
                  entry: pinoLog(
                    ({ context }) => `Waiting for committees for epoch ${context.epoch}`,
                    'EpochProcessor:slotsProcessing',
                  ),
                  on: {
                    COMMITTEES_FETCHED: {
                      target: 'processing',
                    },
                  },
                },
                processing: {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing slots for epoch ${context.epoch}`,
                      'EpochProcessor:slotsProcessing',
                    ),
                    assign({
                      actors: ({ context, spawn }) => ({
                        ...context.actors,
                        slotOrchestratorActor: (() => {
                          const orchestratorId = `slotOrchestrator:${context.epoch}`;

                          const actor = spawn('slotOrchestratorMachine', {
                            id: orchestratorId,
                            input: {
                              epoch: context.epoch,
                              lookbackSlot: context.config.lookbackSlot,
                              slotDuration: context.config.slotDuration,
                              slotController: context.services.slotController,
                            },
                          });

                          logActor(actor, orchestratorId);

                          return actor;
                        })(),
                      }),
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
                },
                updatingSlotsFetched: {
                  entry: pinoLog(
                    ({ context }) => `Updating slots fetched for epoch ${context.epoch}`,
                    'EpochProcessor:slotsProcessing',
                  ),
                  invoke: {
                    src: 'updateSlotsFetched',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      slotsReady: true,
                    }),
                    pinoLog(
                      ({ context }) => `Slots done for epoch ${context.epoch}`,
                      'EpochProcessor:slotsProcessing',
                    ),
                  ],
                },
              },
            },

            trackingValidatorsActivation: {
              description: 'Track validators transitioning between states',
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
                      target: 'processing',
                    },
                  },
                },
                processing: {
                  entry: pinoLog(
                    ({ context }) => `Processing validators activation for epoch ${context.epoch}`,
                    'EpochProcessor:trackingValidatorsActivation',
                  ),
                  invoke: {
                    src: 'trackingTransitioningValidators',
                    input: ({ context }) => ({
                      markValidatorsActivationFetched: (epoch: number) =>
                        context.services.epochController.markValidatorsActivationFetched(epoch),
                      epoch: context.epoch,
                      validatorsController: context.services.validatorsController!,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      validatorsActivationReady: true,
                    }),
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
                      target: 'processing',
                    },
                  },
                },
                processing: {
                  entry: pinoLog(
                    ({ context }) => `Processing validators balances for epoch ${context.epoch}`,
                    'EpochProcessor:validatorsBalances',
                  ),
                  invoke: {
                    src: 'fetchValidatorsBalances',
                    input: ({ context }) => ({
                      validatorsController: context.services.validatorsController!,
                      startSlot: context.startSlot,
                      epoch: context.epoch,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                    onError: {
                      target: 'processing',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      balancesReady: true,
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
              description: 'Fetch rewards after balances and epoch end',
              initial: 'waitingForBalances',
              states: {
                waitingForBalances: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for validators balances before fetching rewards for epoch ${context.epoch}`,
                    'EpochProcessor:rewards',
                  ),
                  on: {
                    VALIDATORS_BALANCES_FETCHED: {
                      target: 'processing',
                    },
                  },
                },
                processing: {
                  entry: pinoLog(
                    ({ context }) => `Processing rewards for epoch ${context.epoch}`,
                    'EpochProcessor:rewards',
                  ),
                  invoke: {
                    src: 'fetchRewardsAfterPrerequisites',
                    input: ({ context }) => ({
                      epochController: context.services.epochController,
                      beaconTime: context.services.beaconTime,
                      epoch: context.epoch,
                      endSlot: context.endSlot,
                      balancesReady: context.balancesReady,
                    }),
                    onDone: {
                      target: 'complete',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: [
                    assign({
                      rewardsReady: true,
                    }),
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
      onDone: 'complete',
    },
    complete: {
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
      },
    },
    epochCompleted: {
      type: 'final',
    },
  },
});
