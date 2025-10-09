import { setup, assign, sendParent, stopChild, raise, ActorRefFrom } from 'xstate';

import { slotOrchestratorMachine, SlotsCompletedEvent } from '../slot/slotOrchestrator.machine.js';

import { EpochController } from '@/src/services/consensus/controllers/epoch.js';
import { BeaconTime } from '@/src/services/consensus/utils/time.js';
import {
  fetchAttestationsRewards,
  fetchValidatorsBalances,
  fetchCommittees,
  fetchSyncCommittees,
  checkSyncCommitteeForEpochInDB,
  updateSlotsFetched,
  updateSyncCommitteesFetched,
  trackingTransitioningValidators,
  markEpochAsProcessed,
} from '@/src/xstate/epoch/epoch.actors.js';
import { logActor } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

export const epochProcessorMachine = setup({
  types: {} as {
    context: {
      epoch: number;
      startSlot: number;
      endSlot: number;
      epochDBSnapshot: {
        validatorsBalancesFetched: boolean;
        validatorsActivationFetched: boolean;
        rewardsFetched: boolean;
        committeesFetched: boolean;
        slotsFetched: boolean;
        syncCommitteesFetched: boolean;
      };
      coordination: {
        committeesReady: boolean;
        epochStarted: boolean;
      };
      config: {
        slotDuration: number;
        lookbackSlot: number;
      };
      services: {
        beaconTime: BeaconTime;
        epochController: EpochController;
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
      };
    };
  },
  actors: {
    fetchValidatorsBalances,
    fetchAttestationsRewards,
    fetchCommittees,
    fetchSyncCommittees,
    checkSyncCommitteeForEpochInDB,
    slotOrchestratorMachine,
    updateSlotsFetched,
    updateSyncCommitteesFetched,
    trackingTransitioningValidators,
    markEpochAsProcessed,
  },
  guards: {
    canProcessEpoch: ({ context }): boolean => {
      const currentEpoch = context.services.beaconTime.getEpochNumberFromTimestamp(Date.now());
      // We need to wait for the epoch to start
      return context.epoch <= currentEpoch + 1;
    },
    canFetchCommittees: ({ context }): boolean => {
      const currentEpoch = context.services.beaconTime.getEpochNumberFromTimestamp(Date.now());
      // We can fetch up to 1 epoch in advance
      return context.epoch < currentEpoch + 1;
    },
    canFetchSyncCommittees: ({ context }): boolean => {
      const currentEpoch = context.services.beaconTime.getEpochNumberFromTimestamp(Date.now());
      // We can fetch up to 1 epoch in advance
      return context.epoch <= currentEpoch + 1;
    },
    hasEpochEnded: ({ context }): boolean => {
      const currentSlot = context.services.beaconTime.getSlotNumberFromTimestamp(Date.now());
      return currentSlot > context.endSlot;
    },
    isFirstEpochOfSyncCommitteePeriod: ({ context }): boolean => {
      return (
        context.epoch ===
        context.services.beaconTime.getSyncCommitteePeriodStartEpoch(context.epoch)
      );
    },
    isLookbackEpoch: ({ context }): boolean => {
      const lookbackEpoch = context.services.beaconTime.getEpochFromSlot(
        context.config.lookbackSlot,
      );
      return context.epoch === lookbackEpoch;
    },
    hasEpochAlreadyStarted: ({ context }): boolean => {
      const currentSlot = context.services.beaconTime.getSlotNumberFromTimestamp(Date.now());
      return currentSlot >= context.startSlot;
    },
    isSyncCommitteeFetched: (_context, params: { isFetched: boolean }): boolean => {
      return params.isFetched === true;
    },
    hasSlotsProcessed: ({ context }) => context.epochDBSnapshot.slotsFetched,
    hasSyncCommitteesFetched: ({ context }) => context.epochDBSnapshot.syncCommitteesFetched,
    needsCommitteesFetch: ({ context }) => !context.epochDBSnapshot.committeesFetched,
    hasValidatorsBalancesFetched: ({ context }) =>
      context.epochDBSnapshot.validatorsBalancesFetched,
    hasValidatorsActivationFetched: ({ context }) =>
      context.epochDBSnapshot.validatorsActivationFetched,
    canProcessSlots: ({ context }) =>
      context.coordination.committeesReady && context.coordination.epochStarted,
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
      epochDBSnapshot: input.epochDBSnapshot,
      coordination: {
        committeesReady: false,
        epochStarted: false,
      },
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
      description:
        'Epoch data can be processed at different times, committee and sync committees can be fetched 1 epoch in advance, the rest needs to wait for the epoch to start',
      entry: pinoLog(
        ({ context }) => `Starting epoch processing for epoch ${context.epoch}`,
        'EpochProcessor',
      ),
      type: 'parallel',
      states: {
        monitoringEpochStart: {
          description: 'Wait for the epoch to start and send the EPOCH_STARTED event',
          initial: 'checkingEpochStatus',
          states: {
            checkingEpochStatus: {
              after: {
                0: [
                  {
                    guard: 'hasEpochAlreadyStarted',
                    target: 'epochStarted',
                  },
                  {
                    target: 'waiting',
                    actions: pinoLog(
                      ({ context }) => `Waiting for epoch ${context.epoch} to start`,
                      'EpochProcessor:waitingForEpochToStart',
                    ),
                  },
                ],
              },
            },
            waiting: {
              after: {
                0: [
                  {
                    guard: 'hasEpochAlreadyStarted',
                    target: 'epochStarted',
                  },
                  {
                    target: 'delaying',
                  },
                ],
              },
            },
            delaying: {
              after: {
                slotDurationHalf: 'waiting',
              },
            },
            epochStarted: {
              type: 'final',
              entry: raise({ type: 'EPOCH_STARTED' }),
              actions: pinoLog(
                ({ context }) => `Epoch ${context.epoch} started`,
                'EpochProcessor:waitingForEpochToStart',
              ),
            },
          },
        },
        fetching: {
          description: 'Fetching data for the epoch',
          type: 'parallel',
          states: {
            committees: {
              description: 'Get epoch committees',
              initial: 'checkingEpochStatus',
              states: {
                checkingEpochStatus: {
                  after: {
                    0: [
                      {
                        guard: 'needsCommitteesFetch',
                        target: 'fetching',
                        actions: pinoLog(
                          ({ context }) => `Fetching committees for epoch ${context.epoch}`,
                          'EpochProcessor:committees',
                        ),
                      },
                      {
                        target: 'complete',
                        actions: pinoLog(
                          ({ context }) => `Committees already fetched for epoch ${context.epoch} `,
                          'EpochProcessor:committees',
                        ),
                      },
                    ],
                  },
                },
                fetching: {
                  invoke: {
                    src: 'fetchCommittees',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: [
                      {
                        target: 'complete',
                      },
                    ],
                  },
                },
                complete: {
                  type: 'final',
                  entry: raise({ type: 'COMMITTEES_FETCHED' }),
                  actions: pinoLog(
                    ({ context }) => `Committees done for epoch ${context.epoch} `,
                    'EpochProcessor:committees',
                  ),
                },
              },
            },

            syncingCommittees: {
              description:
                'Get sync committees. Sync committees persist across multiple epochs, we fetch them only for the first epoch of the sync committee period.',
              initial: 'checkingEpochStatus',
              states: {
                checkingEpochStatus: {
                  after: {
                    0: [
                      {
                        guard: 'hasSyncCommitteesFetched',
                        target: 'complete',
                        actions: pinoLog(
                          ({ context }) =>
                            `Sync committees already fetched for epoch ${context.epoch} `,
                          'EpochProcessor:syncingCommittees',
                        ),
                      },
                      {
                        target: 'checkingInDB',
                      },
                    ],
                  },
                },
                checkingInDB: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Checking sync committees in DB table for epoch ${context.epoch} `,
                    'EpochProcessor:syncingCommittees',
                  ),
                  invoke: {
                    src: 'checkSyncCommitteeForEpochInDB',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: [
                      {
                        guard: {
                          type: 'isSyncCommitteeFetched',
                          params: ({ event }) => ({
                            isFetched: event.output.isFetched,
                          }),
                        },
                        target: 'updatingSyncCommitteesFetched',
                        actions: pinoLog(
                          ({ context }) =>
                            `Sync committees found in DB table for epoch ${context.epoch} `,
                          'EpochProcessor:syncingCommittees',
                        ),
                      },
                      {
                        target: 'fetching',
                        actions: pinoLog(
                          ({ context }) => `Fetching sync committees for epoch ${context.epoch} `,
                          'EpochProcessor:syncingCommittees',
                        ),
                      },
                    ],
                    onError: 'checkingInDB',
                  },
                },
                updatingSyncCommitteesFetched: {
                  invoke: {
                    src: 'updateSyncCommitteesFetched',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: {
                      target: 'complete',
                    },
                    onError: {
                      target: 'updatingSyncCommitteesFetched',
                    },
                  },
                },
                fetching: {
                  invoke: {
                    src: 'fetchSyncCommittees',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: [
                      {
                        target: 'complete',
                      },
                    ],
                    onError: 'fetching',
                  },
                },
                complete: {
                  type: 'final',
                  actions: pinoLog(
                    ({ context }) => `Sync committees done for epoch ${context.epoch} `,
                    'EpochProcessor:syncingCommittees',
                  ),
                },
              },
            },

            slotsProcessing: {
              description:
                'Process slots for the epoch. This state waits for committees to be ready and epoch to start before processing.',
              initial: 'waitingForPrerequisites',
              states: {
                waitingForPrerequisites: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for committees and epoch start for epoch ${context.epoch} `,
                    'EpochProcessor:slotsProcessing',
                  ),
                  on: {
                    COMMITTEES_FETCHED: {
                      actions: assign({
                        coordination: ({ context }) => ({
                          ...context.coordination,
                          committeesReady: true,
                        }),
                      }),
                    },
                    EPOCH_STARTED: {
                      actions: assign({
                        coordination: ({ context }) => ({
                          ...context.coordination,
                          epochStarted: true,
                        }),
                      }),
                    },
                    '*': {
                      target: 'checkingSlotsProcessed',
                      guard: 'canProcessSlots',
                      actions: pinoLog(
                        ({ context }) => `Can start processing slots for epoch ${context.epoch} `,
                        'EpochProcessor:slotsProcessing',
                      ),
                    },
                  },
                },
                checkingSlotsProcessed: {
                  after: {
                    0: [
                      {
                        guard: 'hasSlotsProcessed',
                        target: 'complete',
                        actions: pinoLog(
                          ({ context }) => `Slots already processed for epoch ${context.epoch} `,
                          'EpochProcessor:slotsProcessing',
                        ),
                      },
                      {
                        target: 'processingSlots',
                      },
                    ],
                  },
                },
                processingSlots: {
                  entry: [
                    pinoLog(
                      ({ context }) => `Processing slots for epoch ${context.epoch} `,
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
                            },
                          });

                          // Automatically log the actor's state and context
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
                    ({ context }) => `Updating slots fetched for epoch ${context.epoch} `,
                    'EpochProcessor:slotsProcessing',
                  ),
                  invoke: {
                    src: 'updateSlotsFetched',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: {
                      target: 'complete',
                    },
                    onError: {
                      target: 'updatingSlotsFetched',
                    },
                  },
                },
                complete: {
                  type: 'final',
                  entry: pinoLog(
                    ({ context }) => `Slots done for epoch ${context.epoch} `,
                    'EpochProcessor:slotsProcessing',
                  ),
                },
              },
            },

            trackingValidatorsActivation: {
              description:
                'Get all validators pending of activation and fetch their status to know if they have been activated.',
              initial: 'waitingForEpochStart',
              states: {
                waitingForEpochStart: {
                  entry: pinoLog(
                    ({ context }) =>
                      `Waiting for epoch to start before tracking transitioning validators for epoch ${context.epoch}`,
                    'EpochProcessor:trackingTransitioningValidators',
                  ),
                  on: {
                    EPOCH_STARTED: 'checkingStatus',
                  },
                },
                checkingStatus: {
                  after: {
                    0: [
                      {
                        guard: 'hasValidatorsActivationFetched',
                        target: 'complete',
                        actions: pinoLog(
                          ({ context }) =>
                            `Validators activation already tracked for epoch ${context.epoch} `,
                          'EpochProcessor:trackingTransitioningValidators',
                        ),
                      },
                      {
                        target: 'fetching',
                      },
                    ],
                  },
                },
                fetching: {
                  entry: pinoLog(
                    ({ context }) => `Tracking transitioning validators for epoch ${context.epoch}`,
                    'EpochProcessor:trackingTransitioningValidators',
                  ),
                  invoke: {
                    src: 'trackingTransitioningValidators',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: 'complete',
                  },
                },
                complete: {
                  type: 'final',
                  entry: pinoLog(
                    ({ context }) =>
                      `Tracking transitioning validators done for epoch ${context.epoch}`,
                    'EpochProcessor:trackingTransitioningValidators',
                  ),
                },
              },
            },

            validatorsBalances: {
              description:
                'Get all active beacon validators balances. We need to know the validators balances to calculate missed rewards.',
              initial: 'checkingStatus',
              states: {
                waitingForEpochStart: {
                  on: {
                    EPOCH_STARTED: 'checkingStatus',
                  },
                },
                checkingStatus: {
                  after: {
                    0: [
                      {
                        guard: 'hasValidatorsBalancesFetched',
                        target: 'complete',
                        actions: pinoLog(
                          ({ context }) =>
                            `Validators balances already fetched for epoch ${context.epoch} `,
                          'EpochProcessor:validatorsBalances',
                        ),
                      },
                      {
                        target: 'fetching',
                      },
                    ],
                  },
                },
                fetching: {
                  entry: pinoLog(
                    ({ context }) => `Fetching validators balances for epoch ${context.epoch} `,
                    'EpochProcessor:validatorsBalances',
                  ),
                  invoke: {
                    src: 'fetchValidatorsBalances',
                    input: ({ context }) => ({ startSlot: context.startSlot }),
                    onDone: [
                      {
                        target: 'complete',
                      },
                    ],
                    onError: 'fetching',
                  },
                },
                complete: {
                  entry: raise({ type: 'VALIDATORS_BALANCES_FETCHED' }),
                  type: 'final',
                  actions: pinoLog(
                    ({ context }) => `Validators balances done for epoch ${context.epoch} `,
                    'EpochProcessor:validatorsBalances',
                  ),
                },
              },
            },

            rewards: {
              description: `Rewards can only be processed when: 
                  1. Validators have been fetched for the current epoch.
                  2. The last slot of the epoch has been created in the beacon chain.`,
              initial: 'waitingForValidatorsBalances',
              states: {
                waitingForValidatorsBalances: {
                  actions: pinoLog(
                    ({ context }) =>
                      `Waiting for validators balances to be fetched for epoch ${context.epoch} `,
                    'EpochProcessor:rewards',
                  ),
                  on: {
                    VALIDATORS_BALANCES_FETCHED: 'waitingForEpochToEnd',
                  },
                },
                waitingForEpochToEnd: {
                  after: {
                    0: [
                      {
                        guard: 'hasEpochEnded',
                        target: 'fetching',
                        actions: pinoLog(
                          ({ context }) => `Fetching for epoch ${context.epoch} `,
                          'EpochProcessor:rewards',
                        ),
                      },
                      {
                        target: 'waitingForEpochEndDelaying',
                      },
                    ],
                  },
                },
                waitingForEpochEndDelaying: {
                  after: {
                    slotDurationHalf: 'waitingForEpochToEnd',
                  },
                },
                fetching: {
                  invoke: {
                    src: 'fetchAttestationsRewards',
                    input: ({ context }) => ({ epoch: context.epoch }),
                    onDone: [
                      {
                        target: 'complete',
                      },
                    ],
                  },
                },
                complete: {
                  type: 'final',
                  actions: pinoLog(
                    ({ context }) => `Done for epoch ${context.epoch} `,
                    'EpochProcessor:rewards',
                  ),
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
        onError: {
          target: 'complete',
          actions: pinoLog(
            ({ event }) => `Error marking epoch as processed: ${event.error}`,
            'EpochProcessor',
            'error',
          ),
        },
      },
    },
    epochCompleted: {
      type: 'final',
    },
  },
});
