import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createActor, setup } from 'xstate';

import { Block } from '@/src/services/consensus/types.js';
import { slotProcessorMachine } from '@/src/xstate/slot/slotProcessor.machine.js';

vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

/**
 * Create the smallest block shape used by the slot processor machine.
 */
function createBlock(): Block {
  return {
    data: {
      message: {
        body: {
          attestations: [],
          deposits: [],
          execution_payload: {
            block_number: '123',
            withdrawals: [],
          },
          execution_requests: {
            consolidations: [],
            deposits: [],
            withdrawals: [],
          },
          voluntary_exits: [],
        },
      },
    },
  } as unknown as Block;
}

/**
 * Create a slot controller mock with successful defaults.
 */
function createSlotController() {
  return {
    fetchBeaconBlock: vi.fn().mockResolvedValue(createBlock()),
    fetchBlockRewards: vi.fn().mockResolvedValue(undefined),
    fetchExecutionRewards: vi.fn().mockResolvedValue(undefined),
    fetchSyncCommitteeRewards: vi.fn().mockResolvedValue(undefined),
    getSlot: vi.fn().mockResolvedValue({ processed: false }),
    prefetchBlockRewards: vi.fn(),
    prefetchSyncCommitteeRewards: vi.fn().mockResolvedValue(undefined),
    processAttestations: vi.fn().mockResolvedValue(undefined),
    processDeposits: vi.fn().mockResolvedValue(undefined),
    processEpWithdrawals: vi.fn().mockResolvedValue(undefined),
    processErConsolidations: vi.fn().mockResolvedValue(undefined),
    processErDeposits: vi.fn().mockResolvedValue(undefined),
    processErWithdrawals: vi.fn().mockResolvedValue(undefined),
    processVoluntaryExits: vi.fn().mockResolvedValue(undefined),
    updateAttestationsProcessed: vi.fn().mockResolvedValue(undefined),
    updateSlotProcessed: vi.fn().mockResolvedValue(undefined),
    waitUntilSlotReady: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Let XState settle promise completions and immediate transitions in tests.
 */
async function waitForXStateTransitions() {
  // Multiple microtasks are needed because invoked promises can resolve and then trigger nested transitions.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// This suite verifies retry behavior for the slot processor state machine.
describe('slotProcessorMachine', () => {
  beforeEach(() => {
    // Fake timers make retry delays deterministic in the state machine.
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore real timers so tests outside this suite are not affected.
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  // This test verifies reward prefetching looks far enough ahead while delayed archive endpoints are slow.
  test('prefetches block and sync rewards four slots ahead', async () => {
    // This controller records reward prefetch calls while every processing step succeeds immediately.
    const slotController = createSlotController();

    // This parent receives the slot completion event from the real slot processor.
    const parentMachine = setup({
      actors: {
        slotProcessor: slotProcessorMachine,
      },
    }).createMachine({
      id: 'testRewardPrefetchParent',
      initial: 'running',
      states: {
        running: {
          invoke: {
            id: 'slotProcessor',
            src: 'slotProcessor',
            input: {
              epoch: 1,
              lookbackSlot: 0,
              slot: 32,
              slotController: slotController as never,
              slotDuration: 12_000,
            },
            onDone: {
              target: 'completed',
            },
          },
        },
        completed: {
          type: 'final',
        },
      },
    });

    // This actor runs one successful slot so the fetchingBeaconBlock entry action can prefetch ahead.
    const actor = createActor(parentMachine);

    // Start processing and let the slot complete.
    actor.start();
    await vi.runAllTimersAsync();

    // These assertions verify block rewards are prefetched for the next four slots.
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledTimes(4);
    expect(slotController.prefetchBlockRewards).toHaveBeenNthCalledWith(1, 33);
    expect(slotController.prefetchBlockRewards).toHaveBeenNthCalledWith(2, 34);
    expect(slotController.prefetchBlockRewards).toHaveBeenNthCalledWith(3, 35);
    expect(slotController.prefetchBlockRewards).toHaveBeenNthCalledWith(4, 36);

    // These assertions verify sync committee rewards use the same four-slot prefetch horizon.
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledTimes(4);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenNthCalledWith(1, 33);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenNthCalledWith(2, 34);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenNthCalledWith(3, 35);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenNthCalledWith(4, 36);

    // Stop the actor so no state machine work leaks into other tests.
    actor.stop();
  });

  // This test verifies sync committee rewards retry once after a transient empty-rewards error.
  test('retries sync committee rewards when the first attempt has no rewards', async () => {
    // This controller simulates a period-boundary miss followed by a successful retry.
    const slotController = createSlotController();
    slotController.fetchSyncCommitteeRewards
      .mockRejectedValueOnce(new Error('Sync committee rewards are required'))
      .mockResolvedValueOnce(undefined);

    // This flag verifies the parent received the slot completion event.
    let receivedSlotCompleted = false;

    // This parent receives the slot completion event from the real slot processor.
    const parentMachine = setup({
      actors: {
        slotProcessor: slotProcessorMachine,
      },
    }).createMachine({
      id: 'testSlotParent',
      initial: 'running',
      states: {
        running: {
          invoke: {
            id: 'slotProcessor',
            src: 'slotProcessor',
            input: {
              epoch: 1,
              lookbackSlot: 0,
              slot: 32,
              slotController: slotController as never,
              slotDuration: 12_000,
            },
            onDone: {
              target: 'completed',
            },
          },
          on: {
            SLOT_COMPLETED: {
              actions: () => {
                receivedSlotCompleted = true;
              },
            },
          },
        },
        completed: {
          type: 'final',
        },
      },
    });

    // This actor runs the parent harness and its invoked slot processor.
    const actor = createActor(parentMachine);

    // Start processing and run all timers, including the retry delay.
    actor.start();
    await vi.runAllTimersAsync();

    // This assertion verifies the failed sync rewards request was retried.
    expect(slotController.fetchSyncCommitteeRewards).toHaveBeenCalledTimes(2);

    // This assertion verifies the child emitted its completion event.
    expect(receivedSlotCompleted).toBe(true);

    // This assertion verifies the retry allowed the slot processor to complete.
    expect(actor.getSnapshot().value).toBe('completed');

    // Stop the actor so no state machine work leaks into other tests.
    actor.stop();
  });

  // This test verifies beacon block fetching recovers through XState after the request layer fails.
  test('retries beacon block fetching after waiting five seconds', async () => {
    // This controller simulates a beacon API outage that survives makeReliableRequest once,
    // then returns the block on the next XState-level attempt.
    const slotController = createSlotController();
    slotController.fetchBeaconBlock
      .mockRejectedValueOnce(new Error('beacon archive timeout'))
      .mockResolvedValueOnce(createBlock());

    // This flag verifies the parent sees slot completion after the retry succeeds.
    let receivedSlotCompleted = false;

    // This parent receives the slot completion event from the real slot processor.
    const parentMachine = setup({
      actors: {
        slotProcessor: slotProcessorMachine,
      },
    }).createMachine({
      id: 'testBeaconBlockRetryParent',
      initial: 'running',
      states: {
        running: {
          invoke: {
            id: 'slotProcessor',
            src: 'slotProcessor',
            input: {
              epoch: 1,
              lookbackSlot: 0,
              slot: 32,
              slotController: slotController as never,
              slotDuration: 12_000,
            },
            onDone: {
              target: 'completed',
            },
          },
          on: {
            SLOT_COMPLETED: {
              actions: () => {
                receivedSlotCompleted = true;
              },
            },
          },
        },
        completed: {
          type: 'final',
        },
      },
    });

    // This actor starts slot processing and reaches the first failed beacon block request.
    const actor = createActor(parentMachine);
    actor.start();
    await vi.advanceTimersByTimeAsync(0);

    // The failed request must not retry before the five-second recovery delay elapses.
    expect(slotController.fetchBeaconBlock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(slotController.fetchBeaconBlock).toHaveBeenCalledTimes(1);

    // Advancing the final millisecond triggers the retry, allowing processing to finish.
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    // This assertion verifies the beacon block request was retried by XState.
    expect(slotController.fetchBeaconBlock).toHaveBeenCalledTimes(2);

    // This assertion verifies the retry allowed the slot processor to complete normally.
    expect(receivedSlotCompleted).toBe(true);
    expect(actor.getSnapshot().value).toBe('completed');

    // Stop the actor so no state machine work leaks into other tests.
    actor.stop();
  });

  // This test verifies attestation processing retries after a transient storage or committee lookup failure.
  test('retries attestation processing after waiting five seconds', async () => {
    // This controller simulates a failed attestation update followed by a successful retry.
    const slotController = createSlotController();
    slotController.processAttestations
      .mockRejectedValueOnce(new Error('committee rows locked'))
      .mockResolvedValueOnce(undefined);

    // This flag verifies the parent receives completion once the retry succeeds.
    let receivedSlotCompleted = false;

    // This parent receives the slot completion event from the real slot processor.
    const parentMachine = setup({
      actors: {
        slotProcessor: slotProcessorMachine,
      },
    }).createMachine({
      id: 'testAttestationsRetryParent',
      initial: 'running',
      states: {
        running: {
          invoke: {
            id: 'slotProcessor',
            src: 'slotProcessor',
            input: {
              epoch: 1,
              lookbackSlot: 0,
              slot: 32,
              slotController: slotController as never,
              slotDuration: 12_000,
            },
            onDone: {
              target: 'completed',
            },
          },
          on: {
            SLOT_COMPLETED: {
              actions: () => {
                receivedSlotCompleted = true;
              },
            },
          },
        },
        completed: {
          type: 'final',
        },
      },
    });

    // Start processing and allow the first attestation processing attempt to fail.
    const actor = createActor(parentMachine);
    actor.start();
    await vi.advanceTimersByTimeAsync(0);
    await waitForXStateTransitions();

    // The failed branch must stay parked until the full retry delay elapses.
    expect(slotController.processAttestations).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    await waitForXStateTransitions();
    expect(slotController.processAttestations).toHaveBeenCalledTimes(1);

    // Advancing the last millisecond triggers the retry and lets the slot finish.
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    // These assertions verify the retry happened and restored slot progress.
    expect(slotController.processAttestations).toHaveBeenCalledTimes(2);
    expect(receivedSlotCompleted).toBe(true);
    expect(actor.getSnapshot().value).toBe('completed');

    // Stop the actor so no state machine work leaks into other tests.
    actor.stop();
  });

  // This test verifies the lookback-slot attestation marker retries when its storage update fails.
  test('retries lookback-slot attestation marker after waiting five seconds', async () => {
    // This controller simulates a failed processed-flag update followed by a successful retry.
    const slotController = createSlotController();
    slotController.updateAttestationsProcessed
      .mockRejectedValueOnce(new Error('slot update timeout'))
      .mockResolvedValueOnce(undefined);

    // This flag verifies the parent receives completion after the retry succeeds.
    let receivedSlotCompleted = false;

    // This parent uses slot 32 as both the current slot and lookback slot so the
    // attestation branch takes the updateAttestationsProcessed path.
    const parentMachine = setup({
      actors: {
        slotProcessor: slotProcessorMachine,
      },
    }).createMachine({
      id: 'testUpdateAttestationsRetryParent',
      initial: 'running',
      states: {
        running: {
          invoke: {
            id: 'slotProcessor',
            src: 'slotProcessor',
            input: {
              epoch: 1,
              lookbackSlot: 32,
              slot: 32,
              slotController: slotController as never,
              slotDuration: 12_000,
            },
            onDone: {
              target: 'completed',
            },
          },
          on: {
            SLOT_COMPLETED: {
              actions: () => {
                receivedSlotCompleted = true;
              },
            },
          },
        },
        completed: {
          type: 'final',
        },
      },
    });

    // Start processing and allow the first processed-flag update to fail.
    const actor = createActor(parentMachine);
    actor.start();
    await vi.advanceTimersByTimeAsync(0);
    await waitForXStateTransitions();

    // The failed update must not retry before five seconds pass.
    expect(slotController.updateAttestationsProcessed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    await waitForXStateTransitions();
    expect(slotController.updateAttestationsProcessed).toHaveBeenCalledTimes(1);

    // Advancing the last millisecond triggers the retry and lets the slot finish.
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    // These assertions verify the retry happened and restored slot progress.
    expect(slotController.updateAttestationsProcessed).toHaveBeenCalledTimes(2);
    expect(receivedSlotCompleted).toBe(true);
    expect(actor.getSnapshot().value).toBe('completed');

    // Stop the actor so no state machine work leaks into other tests.
    actor.stop();
  });
});
