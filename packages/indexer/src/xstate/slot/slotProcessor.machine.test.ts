import { readFileSync } from 'node:fs';
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

  // This test verifies reward prefetching warms separate block and sync committee lookahead windows.
  test('prefetches block rewards six slots ahead and sync committee rewards four slots ahead', async () => {
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

    // Verify consensus reward prefetch covers all configured lookahead slots.
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(11);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(12);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(13);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(14);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(15);
    expect(slotController.prefetchBlockRewards).toHaveBeenCalledWith(16);

    // Verify sync committee reward prefetch covers all configured lookahead slots.
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(11);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(12);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(13);
    expect(slotController.prefetchSyncCommitteeRewards).toHaveBeenCalledWith(14);

    // Stop the actor so the pending beacon block request does not keep the test alive.
    actor.stop();
    subscription.unsubscribe();
  });

  // This test verifies slot performance logs stay focused on actionable leaf tasks.
  test('does not register container performance timers for slot processing', () => {
    // Read the machine source so this test guards the configured XState performance actions.
    const machineSource = readFileSync(
      new URL('./slotProcessor.machine.ts', import.meta.url),
      'utf8',
    );

    // These container states mirror child leaf timings and make slow slots harder to diagnose.
    const containerTasks = [
      'processingSlot',
      'beaconBlock',
      'beaconBlockProcessing',
      'executionRewards',
      'blockRewards',
      'syncCommitteeRewards',
    ];

    // Verify none of the container states are registered as performance timer tasks.
    for (const task of containerTasks) {
      expect(machineSource).not.toContain(`startPerformanceTask('${task}')`);
      expect(machineSource).not.toContain(`endPerformanceTask('${task}')`);
    }
  });

  // This test verifies attestation timing focuses on database calls, not CPU-only work.
  test('keeps attestation performance timers focused on database operations', () => {
    // Read the controller and storage sources so this test guards the timer names.
    const controllerSource = readFileSync(
      new URL('../../services/consensus/controllers/slot.ts', import.meta.url),
      'utf8',
    );
    const storageSource = readFileSync(
      new URL('../../services/consensus/storage/slot.ts', import.meta.url),
      'utf8',
    );

    // CPU-only operations are inferable from the total and should not create extra logs.
    expect(controllerSource).not.toContain('processAttestations:parseBits');
    expect(controllerSource).not.toContain('processAttestations:dedupe');

    // Database operations inside the slow attestation save path should be timed directly.
    expect(storageSource).toContain('processAttestations:saveSlotAttestations:buildUpdateQueries');
    expect(storageSource).toContain(
      'processAttestations:saveSlotAttestations:updateCommitteeChunk',
    );
    expect(storageSource).toContain('processAttestations:saveSlotAttestations:upsertSlot');
  });
});
