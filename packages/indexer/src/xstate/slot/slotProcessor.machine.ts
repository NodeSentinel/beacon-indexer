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

import ms from 'ms';
import { assign, fromPromise, sendParent, setup } from 'xstate';

import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { Block } from '@/src/services/consensus/types.js';
import { monitoredState } from '@/src/xstate/monitoring/taskMonitor.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

// Reward endpoints can take longer than two slots on archive nodes, so delayed indexers warm four slots ahead.
const REWARD_PREFETCH_SLOT_LOOKAHEAD = 4;

export interface SlotProcessorContext {
  epoch: number;
  slot: number;
  slotController: SlotController;
  beaconBlockData: {
    rawData: Block | 'SLOT MISSED' | null;
  };
  lookbackSlot: number;
  slotDuration: number;
}

export interface SlotProcessorInput {
  epoch: number;
  slot: number;
  lookbackSlot: number;
  slotController: SlotController;
  slotDuration: number;
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

    // Process all block body data sequentially (deposits, exits, withdrawals, consolidations)
    // These run sequentially to avoid deadlocks on the slot row
    processBlockBodyData: fromPromise(
      async ({
        input,
      }: {
        input: {
          slotController: SlotController;
          slot: number;
          block: Block;
        };
      }) => {
        const { block, slot, slotController } = input;
        const body = block.data.message.body;

        await slotController.processEpWithdrawals(slot, body.execution_payload?.withdrawals || []);
        await slotController.processDeposits(slot, body.deposits || []);
        await slotController.processVoluntaryExits(slot, body.voluntary_exits || []);
        await slotController.processErDeposits(slot, body.execution_requests?.deposits || []);
        await slotController.processErWithdrawals(slot, body.execution_requests?.withdrawals || []);
        await slotController.processErConsolidations(
          slot,
          body.execution_requests?.consolidations || [],
        );
      },
    ),

    // Update slot processed status
    updateSlotProcessed: fromPromise(
      async ({ input }: { input: { slotController: SlotController; slot: number } }) =>
        input.slotController.updateSlotProcessed(input.slot),
    ),
  },
  actions: {
    prefetchNextSlotRewards: ({ context }) => {
      // prefetch block rewards
      for (let slotOffset = 1; slotOffset <= REWARD_PREFETCH_SLOT_LOOKAHEAD; slotOffset++) {
        context.slotController.prefetchBlockRewards(context.slot + slotOffset);
      }

      // sync committee rewards
      for (let slotOffset = 1; slotOffset <= REWARD_PREFETCH_SLOT_LOOKAHEAD; slotOffset++) {
        void context.slotController
          .prefetchSyncCommitteeRewards(context.slot + slotOffset)
          .catch(() => undefined);
      }
    },
  },
  guards: {
    isSlotMissed: ({ context }) => context.beaconBlockData?.rawData === 'SLOT MISSED',
    isLookbackSlot: ({ context }) => context.slot === context.lookbackSlot,
    hasBeaconBlockData: ({ context }) => context.beaconBlockData?.rawData !== null,
  },
  delays: {
    retryWait: ms('5s'),
  },
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
    slotDuration: input.slotDuration,
  }),

  states: {
    gettingSlot: monitoredState('get slot', {
      description: 'Getting the slot from the database and checking if already processed.',
      entry: [
        pinoLog(({ context }) => `Getting slot ${context.slot}`, 'SlotProcessor:gettingSlot'),
      ],
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
    }),

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

    fetchingBeaconBlock: monitoredState('fetch beacon block', {
      description:
        'Fetches the beacon block from the consensus layer API and save the response in the context to be processed by internal states',
      entry: [
        'prefetchNextSlotRewards',
        pinoLog(
          ({ context }) => `Fetching beacon block data for slot ${context.slot}`,
          'SlotProcessor:fetchingBeaconData',
        ),
      ],
      invoke: {
        src: 'fetchBeaconBlock',
        input: ({ context }) => ({
          slotController: context.slotController,
          slot: context.slot,
        }),
        onDone: {
          target: 'checkingForMissedSlot',
          actions: assign({
            beaconBlockData: ({ context, event }) => ({
              ...context.beaconBlockData,
              rawData: event.output,
            }),
          }),
        },
        onError: {
          target: 'waitingBeaconBlockRetry',
          actions: pinoLog(
            ({ context, event }) =>
              `error fetching beacon block data for slot ${context.slot}: ${event.error}`,
            'SlotProcessor:fetchingBeaconData',
            'error',
          ),
        },
      },
    }),

    waitingBeaconBlockRetry: {
      after: {
        retryWait: 'fetchingBeaconBlock',
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

    processingSlot: monitoredState('slot', {
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
                    processingAttestations: monitoredState('process attestations', {
                      entry: [
                        pinoLog(
                          ({ context }) => `processing attestations for slot ${context.slot}`,
                          'SlotProcessor:attestations',
                        ),
                      ],
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
                          target: 'waitingAttestationsRetry',
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing attestations for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:attestations',
                            'error',
                          ),
                        },
                      },
                    }),
                    waitingAttestationsRetry: {
                      after: {
                        retryWait: 'processingAttestations',
                      },
                    },
                    updateAttestationsProcessed: monitoredState('update attestations', {
                      entry: [
                        pinoLog(
                          ({ context }) =>
                            `updating attestations processed flag for slot ${context.slot}`,
                          'SlotProcessor:attestations',
                        ),
                      ],
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
                          target: 'waitingAttestationsProcessedUpdateRetry',
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error updating attestations processed flag for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:attestations',
                            'error',
                          ),
                        },
                      },
                    }),
                    waitingAttestationsProcessedUpdateRetry: {
                      after: {
                        retryWait: 'updateAttestationsProcessed',
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
                    processing: monitoredState('fetch execution rewards', {
                      entry: [
                        pinoLog(
                          ({ context }) =>
                            `fetching blockRewards(execution) for slot ${context.slot}`,
                          'SlotProcessor:blockRewards(execution)',
                        ),
                      ],
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
                          target: 'waitingRetry',
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching blockRewards(execution) for slot ${context.slot}, waiting slotHalf before retrying: ${event.error}`,
                            'SlotProcessor:blockRewards(execution)',
                            'error',
                          ),
                        },
                      },
                    }),
                    waitingRetry: {
                      after: {
                        retryWait: 'processing',
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) =>
                          `complete blockRewards(execution) for slot ${context.slot}`,
                        'SlotProcessor:blockRewards(execution)',
                      ),
                    },
                  },
                },
                blockRewards: {
                  description: 'Fetching block rewards (consensus rewards) for the slot proposer.',
                  initial: 'processing',
                  states: {
                    processing: monitoredState('fetch block rewards', {
                      entry: [
                        pinoLog(
                          ({ context }) =>
                            `fetching blockRewards(consensus) for slot ${context.slot}`,
                          'SlotProcessor:blockRewards(consensus)',
                        ),
                      ],
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
                          target: 'waitingRetry',
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching blockRewards(consensus) for slot ${context.slot}, waiting slotHalf before retrying: ${event.error}`,
                            'SlotProcessor:blockRewards(consensus)',
                            'error',
                          ),
                        },
                      },
                    }),
                    waitingRetry: {
                      after: {
                        retryWait: 'processing',
                      },
                    },
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) =>
                          `complete blockRewards(consensus) for slot ${context.slot}`,
                        'SlotProcessor:blockRewards(consensus)',
                      ),
                    },
                  },
                },
                syncCommitteeRewards: {
                  description: 'Fetching sync committee rewards for the slot.',
                  initial: 'processing',
                  states: {
                    processing: monitoredState('fetch sync rewards', {
                      entry: [
                        pinoLog(
                          ({ context }) =>
                            `fetching sync committee rewards for slot ${context.slot}`,
                          'SlotProcessor:syncCommitteeRewards',
                        ),
                      ],
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
                          target: 'waitingRetry',
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error fetching sync committee rewards for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:syncCommitteeRewards',
                            'error',
                          ),
                        },
                      },
                    }),
                    waitingRetry: {
                      after: {
                        retryWait: 'processing',
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
                // Process all block body data sequentially:
                // ep withdrawals, deposits, voluntary exits, er deposits, er withdrawals, er consolidations
                blockBodyData: {
                  description:
                    'Processing block body data sequentially to avoid deadlocks on the slot row',
                  initial: 'processing',
                  states: {
                    processing: monitoredState('process block body', {
                      entry: [
                        pinoLog(
                          ({ context }) => `processing block body data for slot ${context.slot}`,
                          'SlotProcessor:blockBodyData',
                        ),
                      ],
                      invoke: {
                        src: 'processBlockBodyData',
                        input: ({ context }) => ({
                          slotController: context.slotController,
                          slot: context.slot,
                          block: context.beaconBlockData?.rawData as Block,
                        }),
                        onDone: {
                          target: 'complete',
                        },
                        onError: {
                          actions: pinoLog(
                            ({ context, event }) =>
                              `error processing block body data for slot ${context.slot}: ${event.error}`,
                            'SlotProcessor:blockBodyData',
                            'error',
                          ),
                        },
                      },
                    }),
                    complete: {
                      type: 'final',
                      entry: pinoLog(
                        ({ context }) => `complete block body data for slot ${context.slot}`,
                        'SlotProcessor:blockBodyData',
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
    }),

    markingSlotCompleted: monitoredState('mark slot processed', {
      description: 'Marking the slot as completed.',
      entry: [
        pinoLog(
          ({ context }) => `Marking slot completed ${context.slot}`,
          'SlotProcessor:markingSlotCompleted',
        ),
      ],
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
    }),

    completed: {
      entry: [
        sendParent({ type: 'SLOT_COMPLETED' }),
        pinoLog(({ context }) => `Completed slot ${context.slot}`, 'SlotProcessor:slotCompleted'),
      ],
      type: 'final',
    },
  },
});
