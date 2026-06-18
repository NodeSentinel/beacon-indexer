import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';

// Stub logging so the test isolates the machine orchestration contract.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('validatorActivityStatusMachine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls every second and delegates each tick to the controller sync method', async () => {
    // Use fake timers so the polling loop can be triggered without wall-clock delay.
    vi.useFakeTimers();

    // Expose only the controller method that should be called by the machine.
    const syncCurrentActivityStatus = vi.fn().mockResolvedValue(undefined);

    // Start the actor with the controller-only contract that the refactor requires.
    const actor = createActor(validatorActivityStatusMachine, {
      input: {
        validatorActivityStatusController: {
          syncCurrentActivityStatus,
        } as unknown as ValidatorActivityStatusController,
        maxAttestationDelay: 2,
        inactiveMissedCount: 3,
      } as never,
    });

    actor.start();

    // Advance just below one polling interval so no early sync can run.
    await vi.advanceTimersByTimeAsync(999);

    expect(syncCurrentActivityStatus).not.toHaveBeenCalled();

    // Advance to exactly one second so the machine invokes the controller sync.
    await vi.advanceTimersByTimeAsync(1);

    expect(syncCurrentActivityStatus).toHaveBeenCalledWith({
      maxAttestationDelay: 2,
      inactiveMissedCount: 3,
    });

    actor.stop();
  });
});
