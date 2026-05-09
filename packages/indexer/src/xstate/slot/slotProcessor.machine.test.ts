import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createAndStartActor, createControllablePromise } from '@/src/__tests__/utils.js';
import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { slotProcessorMachine } from '@/src/xstate/slot/slotProcessor.machine.js';

const performanceLoggerMocks = vi.hoisted(() => ({
  endPerformanceTask: vi.fn(() => () => {}),
  startPerformanceTask: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

vi.mock('@/src/xstate/performanceLogger.js', () => performanceLoggerMocks);

// This suite verifies slot-level prefetching that hides slow reward requests.
describe('slotProcessorMachine', () => {
  beforeEach(() => {
    // Reset mocks so each test observes only its own machine run.
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clear timers in case XState scheduled retry delays during a test.
    vi.clearAllTimers();
  });

  // This test verifies reward prefetching warms the next two sequential slots.
  test('prefetches rewards for the next two slots when fetching the current block', async () => {
    // Keep beacon block fetching pending so the test can inspect entry actions.
    const beaconBlockFetch = createControllablePromise<never>();

    // This controller mock returns enough data to reach the beacon block fetching state.
    const slotController = {
      getSlot: vi.fn().mockResolvedValue({ processed: false }),
      waitUntilSlotReady: vi.fn().mockResolvedValue(undefined),
      fetchBeaconBlock: vi.fn().mockReturnValue(beaconBlockFetch.promise),
      prefetchBlockRewards: vi.fn(),
      prefetchSyncCommitteeRewards: vi.fn().mockResolvedValue(undefined),
    } as unknown as SlotController;

    // Start the machine at slot 10 so expected prefetch slots are easy to read.
    const { actor, subscription } = createAndStartActor(slotProcessorMachine, {
      epoch: 1,
      slot: 10,
      lookbackSlot: 0,
      slotController,
      slotDuration: 12_000,
    });

    // Wait until the machine enters fetchingBeaconBlock and runs the existing prefetch action.
    await vi.waitFor(() => {
      expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(11);
    });

    // Verify consensus reward prefetch covers both immediate lookahead slots.
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(11);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(12);

    // Verify sync committee reward prefetch covers both immediate lookahead slots.
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(11);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(12);

    // Stop the actor so the pending beacon block request does not keep the test alive.
    actor.stop();
    subscription.unsubscribe();
  });
});
