import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { activityMachine } from './activity.machine.js';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';

// Stub logging so the test isolates the machine orchestration contract.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('activityMachine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delegates each polling tick to the controller runSync method', async () => {
    // Use fake timers so the polling loop can be triggered without wall-clock delay.
    vi.useFakeTimers();

    // Expose only the controller method that should be called by the machine.
    const runSync = vi.fn().mockResolvedValue(undefined);

    // Start the actor with the controller-only contract that the refactor requires.
    const actor = createActor(activityMachine, {
      input: {
        validatorActivityStatusController: {
          runSync,
        } as unknown as ValidatorActivityStatusController,
        slotDuration: 1,
        skipValidatorStatusUpdateWhenBehindHeadSlots: 4,
        maxAttestationDelay: 2,
        inactiveMissedCount: 3,
      } as never,
    });

    actor.start();

    // Advance one polling interval so the machine invokes the controller sync.
    await vi.advanceTimersByTimeAsync(1);

    expect(runSync).toHaveBeenCalledWith({
      skipValidatorStatusUpdateWhenBehindHeadSlots: 4,
      maxAttestationDelay: 2,
      inactiveMissedCount: 3,
    });

    actor.stop();
  });
});
