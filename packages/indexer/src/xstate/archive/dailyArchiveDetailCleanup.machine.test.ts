import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { dailyArchiveDetailCleanupMachine } from './dailyArchiveDetailCleanup.machine.js';

import { DailyArchiveDetailCleanupController } from '@/src/services/consensus/controllers/dailyArchiveDetailCleanup.js';

// Stub logging so this suite checks only orchestration behavior.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('dailyArchiveDetailCleanupMachine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('wakes every ten minutes and delegates cleanup to the controller', async () => {
    // Use fake timers so the ten-minute polling interval runs immediately.
    vi.useFakeTimers();

    // Expose only the controller method that the machine should invoke.
    const cleanupOldDailyDetails = vi.fn().mockResolvedValue({ batches: 0, rows: 0 });

    // Start the actor with the cleanup controller dependency.
    const actor = createActor(dailyArchiveDetailCleanupMachine, {
      input: {
        dailyArchiveDetailCleanupController: {
          cleanupOldDailyDetails,
        } as unknown as DailyArchiveDetailCleanupController,
      },
    });
    actor.start();

    // Advance just below the polling interval so cleanup does not run early.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
    expect(cleanupOldDailyDetails).not.toHaveBeenCalled();

    // Advance to the ten-minute boundary so one cleanup pass runs.
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanupOldDailyDetails).toHaveBeenCalledTimes(1);

    actor.stop();
  });

  it('does not overlap cleanup passes while a cleanup is still running', async () => {
    // Use fake timers to trigger multiple wakeups without waiting.
    vi.useFakeTimers();

    let resolveCleanup!: (value: { batches: number; rows: number }) => void;

    // Keep the first cleanup pending so the second timer cannot overlap it.
    const cleanupOldDailyDetails = vi.fn(
      () =>
        new Promise<{ batches: number; rows: number }>((resolve) => {
          resolveCleanup = resolve;
        }),
    );

    // Start the actor with a delayed cleanup controller.
    const actor = createActor(dailyArchiveDetailCleanupMachine, {
      input: {
        dailyArchiveDetailCleanupController: {
          cleanupOldDailyDetails,
        } as unknown as DailyArchiveDetailCleanupController,
      },
    });
    actor.start();

    // Trigger the first cleanup pass.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(cleanupOldDailyDetails).toHaveBeenCalledTimes(1);

    // Advance another interval while the first pass is pending.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(cleanupOldDailyDetails).toHaveBeenCalledTimes(1);

    // Resolve the first pass and let the machine return to waiting.
    resolveCleanup({ batches: 1, rows: 10_000 });
    await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('waiting'));

    actor.stop();
  });
});
