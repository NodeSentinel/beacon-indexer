/**
 * @fileoverview The slot processor is a state machine that is responsible for processing individual slots.
 *
 * It is responsible for:
 * - Fetching and processing beacon block data
 * - Processing different types of data in parallel:
 *   - Execution Layer rewards
 *   - Block and sync rewards
 *   - Attestations
 * - Handling errors with retry logic
 * - Emitting completion events
 *
 * This machine processes one slot at a time.
 *
 * NOTE: This machine uses controller-based inline actors. The old slot.actors.ts file
 * is considered legacy and should be removed once all consumers have migrated.
 */

import { setup, assign, sendParent, fromPromise } from 'xstate';

import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { Block } from '@/src/services/consensus/types.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

export interface SlotProcessorContext {
  epoch: number;
  slot: number;
  slotController: SlotController;
  beaconBlockData: {
    rawData: Block | 'SLOT MISSED' | null;
  };
  lookbackSlot: number;
}

export interface SlotProcessorInput {
  epoch: number;
  slot: number;
  lookbackSlot: number;
  slotController: SlotController;
}

export const slotProcessorMachine = setup({
  types: {} as {
    context: SlotProcessorContext;
    input: SlotProcessorInput;
  },
  actors: {
    // Get slot from database
    getSlot: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.getSlot(input.slot),
    ),

    // Wait until slot is ready to be processed (calculates exact wait time)
    waitUntilSlotReady: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.waitUntilSlotReady(input.slot),
    ),

    // Fetch beacon block data
    fetchBeaconBlock: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.fetchBeaconBlock(input.slot),
    ),

    // Fetch execution layer rewards
    fetchELRewards: fromPromise(
      async ({
        input,
      }: {
        input: { slotController: SlotController; slot: number; block: number };
      }) => input.slotController.fetchExecutionRewards(input.slot, input.block),
    ),

    // Fetch block rewards (consensus rewards)
    fetchBlockRewards: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
        };
      }) => input.slotController.fetchBlockRewards(input.slot),
    ),

    // Fetch sync committee rewards
    fetchSyncCommitteeRewards: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
        };
      }) => input.slotController.fetchSyncCommitteeRewards(input.slot),
    ),

    // Process attestations
    processAttestations: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slotNumber: number;
          attestations: Block['data']['message']['body']['attestations'];
        };
      }) => input.slotController.processAttestations(input.slotNumber, input.attestations),
    ),

    // Update attestations processed status
    updateAttestationsProcessed: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.updateAttestationsProcessed(input.slot),
    ),

    // Process execution payload withdrawals
    processEpWithdrawals: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          withdrawals: Block['data']['message']['body']['execution_payload']['withdrawals'];
        };
      }) => input.slotController.processEpWithdrawals(input.slot, input.withdrawals),
    ),

    // Process deposits
    processDeposits: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          deposits: Block['data']['message']['body']['deposits'];
        };
      }) => input.slotController.processDeposits(input.slot, input.deposits),
    ),

    // Process voluntary exits
    processVoluntaryExits: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          voluntaryExits: Block['data']['message']['body']['voluntary_exits'];
        };
      }) => input.slotController.processVoluntaryExits(input.slot, input.voluntaryExits),
    ),

    // Process execution requests deposits
    processErDeposits: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          deposits: NonNullable<Block['data']['message']['body']['execution_requests']>['deposits'];
        };
      }) => input.slotController.processErDeposits(input.slot, input.deposits),
    ),

    // Process execution requests withdrawals
    processErWithdrawals: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          withdrawals: NonNullable<
            Block['data']['message']['body']['execution_requests']
          >['withdrawals'];
        };
      }) => input.slotController.processErWithdrawals(input.slot, input.withdrawals),
    ),

    // Process execution requests consolidations
    processErConsolidations: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          consolidations: NonNullable<
            Block['data']['message']['body']['execution_requests']
          >['consolidations'];
        };
      }) => input.slotController.processErConsolidations(input.slot, input.consolidations),
    ),

    // Update slot processed status
    updateSlotProcessed: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.updateSlotProcessed(input.slot),
    ),
  },
  guards: {
    isSlotMissed: ({ context }) => context.beaconBlockData?.rawData === 'SLOT MISSED',
    isLookbackSlot: ({ context }) => context.slot === context.lookbackSlot,
    hasBeaconBlockData: ({ context }) => context.beaconBlockData?.rawData !== null,
  },
  delays: {},
}).createMachine({
  id: 'SlotProcessor',
  initial: 'gettingSlot',
  context: ({ input }) => ({
    epoch: input.epoch,
    slot: input.slot,
    slotController: input.slotController,
    beaconBlockData: {
      rawData: null,
    },
    lookbackSlot: input.lookbackSlot,
  }),

  states: {
    gettingSlot: {
      description: 'Getting the slot from the database and checking if already processed.',
      entry: pinoLog(({ context }) => `Getting slot ${context.slot}`, 'SlotProcessor:gettingSlot'),
      invoke: {
        src: 'getSlot',
        input: ({ context }) => ({
          slotController: context.slotController,
          slot: context.slot,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output?.processed === true,
            target: 'completed',
          },
          {
            target: 'waitingForSlotToStart',
          },
        ],
        onError: {
          actions: pinoLog(
            ({ context, event }) => `error getting slot ${context.slot}: ${event.error}`,
            'SlotProcessor:gettingSlot',
            'error',
          ),
        },
      },
    },

    waitingForSlotToStart: {
      description:
        'Waiting for the slot to be ready. Uses beaconTime to calculate exact wait time.',
      entry: pinoLog(
        ({ context }) => `Waiting for slot ${context.slot} to be ready`,
        'SlotProcessor:waitingForSlotToStart',
      ),
      invoke: {
        src: 'waitUntilSlotReady',
        input: ({ context }) => ({
          slotController: context.slotController,
          slot: context.slot,
        }),
        onDone: {
          target: 'fetchingBeaconBlock',
        },
        onError: {
          actions: pinoLog(
            ({ context, event }) =>
              `error waiting for slot ${context.slot} to be ready: ${event.error}`,
            'SlotProcessor:waitingForSlotToStart',
            'error',
          ),
        },
      },
    },

    fetchingBeaconBlock: {
      description:
        'Fetches the beacon block from the consensus layer API and save the response in the context to be processed by internal states',
      entry: pinoLog(
        ({ context }) => `Fetching beacon block data for slot ${context.slot}`,
        'SlotProcessor:fetchingBeaconData',
      ),
      invoke: {
        src: 'fetchBeaconBlock',
        input: ({ context }) => ({
          slotController: context.slotController,
          slot: context.slot,
        }),
        onDone: {
          target: 'checkingForMissedSlot',
          actions: assign({
            beaconBlockData: ({ event, context }) => ({
              ...context.beaconBlockData,
              rawData: event.output,
            }),
          }),
        },
        onError: {
          actions: pinoLog(
            ({ context, event }) =>
              `error fetching beacon block data for slot ${context.slot}: ${event.error}`,
            'SlotProcessor:fetchingBeaconData',
            'error',
          ),
        },
      },
    },

    checkingForMissedSlot: {
      description: 'Check if the slot was missed or has valid data',
      always: [
        {
          guard: 'isSlotMissed',
          target: 'markingSlotCompleted',
        },
        {
          target: 'processingSlot',
        },
      ],
    },

    processingSlot: {
      description: 'In this state we fetch/process all the information from the block.',
      type: 'parallel',
      onDone: 'markingSlotCompleted',
      states: {
        beaconBlock: {
          description:
            'In this state the information fetched in fetchingBeaconBlock state is processed.',
          initial: 'processing',
          states: {
            processing: {
              type: 'parallel',
              onDone: 'complete',
              states: {
                attestations: {
                  description:
                    'Processing the attestations for the slot, attestations for slot n include attestations for slot n-1 up to n-slotsInEpoch',
                  initial: 'verifyingDone',
                  states: {
                    verifyingDone: {
                      always: [
                        {
                          description:
                            'if we are processing the slot CONSENSUS_LOOKBACK_SLOT, we mark attestations processed immediately ' +
                            'as it brings attestations for slots < CONSENSUS_LOOKBACK_SLOT and we should ignore them.',
                          guard: 'isLookbackSlot',
                          target: 'updateAttestationsProcessed',
                        },
                        {
                          target: 'processingAttestations',
                        },
                      ],
                    },
                    processingAttestations: {
                      entry: pinoLog(
                        ({ context }) => `processing attestations for slot ${context.slot}`,
                        'SlotProcessor:attestations',
                      ),
                      invoke: {
                        src: 'processAttestations',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slotNumber: context.slot,
                            attestations: _beaconBlockData.data.message.body.attestations ?? [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing attestations for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:attestations',
                            'error',
                          ),
                        },
                      },
                    },
                    updateAttestationsProcessed: {
                      entry: pinoLog(
                        ({ context }) =>
                          `updating attestations processed flag for slot ${context.slot}`,
                        'SlotProcessor:attestations',
                      ),
                      invoke: {
                        src: 'updateAttestationsProcessed',
                        input: ({ context }) => ({
                          slotController: context.slotController,
                          slot: context.slot,
                        }),
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error updating attestations processed flag for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:attestations',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      entry: pinoLog(
                        ({ context }) => `attestations complete for slot ${context.slot}`,
                        'SlotProcessor:attestations',
                      ),
                      type: 'final',
                    },
                    error: {
                      type: 'final',
                    },
                  },
                },
                executionRewards: {
                  description: 'Fetching execution layer rewards for the slot proposer.',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `fetching execution rewards for slot ${context.slot}`,
                        'SlotProcessor:executionRewards',
                      ),
                      invoke: {
                        src: 'fetchELRewards',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            block: Number(
                              _beaconBlockData.data.message.body.execution_payload.block_number,
                            ),
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching execution rewards for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:executionRewards',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete execution rewards for slot ${context.slot}`,
                        'SlotProcessor:executionRewards',
                      ),
                    },
                  },
                },
                blockRewards: {
                  description: 'Fetching block rewards (consensus rewards) for the slot proposer.',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `fetching block rewards for slot ${context.slot}`,
                        'SlotProcessor:blockRewards',
                      ),
                      invoke: {
                        src: 'fetchBlockRewards',
                        input: ({ context }) => {
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching block rewards for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:blockRewards',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete block rewards for slot ${context.slot}`,
                        'SlotProcessor:blockRewards',
                      ),
                    },
                  },
                },
                syncCommitteeRewards: {
                  description: 'Fetching sync committee rewards for the slot.',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `fetching sync committee rewards for slot ${context.slot}`,
                        'SlotProcessor:syncCommitteeRewards',
                      ),
                      invoke: {
                        src: 'fetchSyncCommitteeRewards',
                        input: ({ context }) => {
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching sync committee rewards for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:syncCommitteeRewards',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete sync committee rewards for slot ${context.slot}`,
                        'SlotProcessor:syncCommitteeRewards',
                      ),
                    },
                  },
                },
                // data.message.body.execution_payload.withdrawals
                epWithdrawals: {
                  description:
                    'Processing execution payload withdrawals, from beacon chain to validator balances',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing ep withdrawals for slot ${context.slot}`,
                        'SlotProcessor:epWithdrawals',
                      ),
                      invoke: {
                        src: 'processEpWithdrawals',
                        input: ({ context }) => {
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            withdrawals:
                              (context.beaconBlockData?.rawData as Block)?.data?.message?.body
                                ?.execution_payload?.withdrawals || [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing ep withdrawals for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:epWithdrawals',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete ep withdrawals for slot ${context.slot}`,
                        'SlotProcessor:epWithdrawals',
                      ),
                    },
                  },
                },
                // data.message.body.deposits
                deposits: {
                  // block with deposits: https://rpc-gbc.gnosischain.com/eth/v2/beacon/blocks/21407372
                  description: 'Processing deposits from beacon block',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing deposits for slot ${context.slot}`,
                        'SlotProcessor:deposits',
                      ),
                      invoke: {
                        src: 'processDeposits',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            deposits: _beaconBlockData?.data?.message?.body?.deposits || [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing deposits for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:deposits',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete deposits for slot ${context.slot}`,
                        'SlotProcessor:deposits',
                      ),
                    },
                  },
                },
                // data.message.body.voluntary_exits
                voluntaryExits: {
                  // block with voluntary exits: https://rpc-gbc.gnosischain.com/eth/v2/beacon/blocks/21407464
                  description: 'Processing voluntary exits from beacon block',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing voluntary exits for slot ${context.slot}`,
                        'SlotProcessor:voluntaryExits',
                      ),
                      invoke: {
                        src: 'processVoluntaryExits',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            voluntaryExits:
                              _beaconBlockData?.data?.message?.body?.voluntary_exits || [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing voluntary exits for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:voluntaryExits',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete voluntary exits for slot ${context.slot}`,
                        'SlotProcessor:voluntaryExits',
                      ),
                    },
                  },
                },
                // data.message.body.execution_requests.deposits
                erDeposits: {
                  // block with er deposits: https://rpc-gbc.gnosischain.com/eth/v2/beacon/blocks/24300383
                  description: 'Processing execution requests deposits',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing er deposits for slot ${context.slot}`,
                        'SlotProcessor:erDeposits',
                      ),
                      invoke: {
                        src: 'processErDeposits',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            deposits:
                              _beaconBlockData?.data?.message?.body?.execution_requests?.deposits ||
                              [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing er deposits for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:erDeposits',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete er deposits for slot ${context.slot}`,
                        'SlotProcessor:erDeposits',
                      ),
                    },
                  },
                },
                // data.message.body.execution_requests.withdrawals
                erWithdrawals: {
                  // block with er withdrawals: https://rpc-gbc.gnosischain.com/eth/v2/beacon/blocks/25125194
                  description: 'Processing execution requests withdrawals',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing er withdrawals for slot ${context.slot}`,
                        'SlotProcessor:erWithdrawals',
                      ),
                      invoke: {
                        src: 'processErWithdrawals',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            withdrawals:
                              _beaconBlockData?.data?.message?.body?.execution_requests
                                ?.withdrawals || [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing er withdrawals for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:erWithdrawals',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete er withdrawals for slot ${context.slot}`,
                        'SlotProcessor:erWithdrawals',
                      ),
                    },
                  },
                },
                // data.message.body.execution_requests.consolidations
                erConsolidations: {
                  // block with er consolidations: https://rpc-gbc.gnosischain.com/eth/v2/beacon/blocks/24877955
                  description: 'Processing execution requests consolidations',
                  initial: 'processing',
                  states: {
                    processing: {
                      entry: pinoLog(
                        ({ context }) => `processing er consolidations for slot ${context.slot}`,
                        'SlotProcessor:erConsolidations',
                      ),
                      invoke: {
                        src: 'processErConsolidations',
                        input: ({ context }) => {
                          const _beaconBlockData = context.beaconBlockData?.rawData as Block;
                          return {
                            slotController: context.slotController,
                            slot: context.slot,
                            consolidations:
                              _beaconBlockData?.data?.message?.body?.execution_requests
                                ?.consolidations || [],
                          };
                        },
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing er consolidations for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:erConsolidations',
                            'error',
                          ),
                        },
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete er consolidations for slot ${context.slot}`,
                        'SlotProcessor:erConsolidations',
                      ),
                    },
                  },
                },
                // TODO
                // data.message.body.proposer_slashings
                // data.message.body.attester_slashings
              },
            },
            complete: {
              type: 'final',
            },
          },
        },
      },
    },

    markingSlotCompleted: {
      description: 'Marking the slot as completed.',
      entry: pinoLog(
        ({ context }) => `Marking slot completed ${context.slot}`,
        'SlotProcessor:markingSlotCompleted',
      ),
      invoke: {
        src: 'updateSlotProcessed',
        input: ({ context }) => ({
          slotController: context.slotController,
          slot: context.slot,
        }),
        onDone: {
          target: 'completed',
        },
        onError: {
          target: 'markingSlotCompleted',
          actions: pinoLog(
            ({ context, event }) => `error marking slot completed ${context.slot}: ${event.error}`,
            'SlotProcessor:markingSlotCompleted',
            'error',
          ),
        },
      },
    },

    completed: {
      entry: [
        sendParent({ type: 'SLOT_COMPLETED' }),
        pinoLog(({ context }) => `Completed slot ${context.slot}`, 'SlotProcessor:slotCompleted'),
      ],
      type: 'final',
    },
  },
});
