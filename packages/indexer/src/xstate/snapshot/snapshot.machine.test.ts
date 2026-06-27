import type { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import type { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';

// Stub logging so the test verifies snapshot scheduling without writing logs.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('snapshotMachine', () => {
  afterEach(() => {
    // Restore timer and mock state so each scenario starts from a clean scheduler.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips snapshot work while the indexer is more than five epochs behind', async () => {
    // This scenario represents production lag: the chain head is far beyond the last slot
    // that completed indexing, so snapshot aggregation must not scan live raw tables.
    vi.useFakeTimers();

    // Head slot 1_000 and last processed slot 800 produce more than five epochs of lag.
    const beaconTime = {
      getChainCurrentSlot: vi.fn(() => 1_000),
      getLookbackSlot: vi.fn(() => 800),
    } as unknown as BeaconTime;

    // The slot controller is the canonical source for actual indexer progress.
    const slotController = {
      getLastProcessedSlot: vi.fn().mockResolvedValue(800),
    } as unknown as SlotController;

    // Every snapshot mutation is mocked so the test can prove the delayed guard aborts the tick.
    const snapshotController = {
      getCurrentEpoch: vi.fn(() => 31),
      detectAndBackfillNewValidators: vi.fn().mockResolvedValue(0),
      updateBalances: vi.fn().mockResolvedValue(undefined),
      updatePerformanceH: vi.fn().mockResolvedValue(undefined),
      updatePerformanceD: vi.fn().mockResolvedValue(undefined),
      updatePerformanceW: vi.fn().mockResolvedValue(undefined),
      updatePerformanceM: vi.fn().mockResolvedValue(undefined),
    } as unknown as SnapshotController;

    // Start the actor with 32 slots per epoch, so a 200-slot lag is unsafe for snapshots.
    const actor = createActor(snapshotMachine, {
      input: {
        snapshotController,
        slotController,
        beaconTime,
        slotDuration: 1,
        slotsPerEpoch: 32,
        chain: 'ethereum',
        maxAttestationDelay: 5,
        delaySlotsToHead: 3,
        missedAttestationsForInactivity: 3,
      },
    });

    actor.start();

    // Advance one snapshot interval and let the invoked async tick finish.
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(slotController.getLastProcessedSlot).toHaveBeenCalled();
    });
    actor.stop();

    // The delayed guard must stop before wall-clock snapshot calculations begin.
    expect(snapshotController.getCurrentEpoch).not.toHaveBeenCalled();
    expect(snapshotController.detectAndBackfillNewValidators).not.toHaveBeenCalled();
    expect(snapshotController.updateBalances).not.toHaveBeenCalled();
    expect(snapshotController.updatePerformanceH).not.toHaveBeenCalled();
    expect(snapshotController.updatePerformanceD).not.toHaveBeenCalled();
    expect(snapshotController.updatePerformanceW).not.toHaveBeenCalled();
    expect(snapshotController.updatePerformanceM).not.toHaveBeenCalled();
  });
});
