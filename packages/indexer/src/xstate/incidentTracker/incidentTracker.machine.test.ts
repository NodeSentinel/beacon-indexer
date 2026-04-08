import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { incidentTrackerMachine } from './incidentTracker.machine.js';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';

// Stub logging so state-machine tests focus on orchestration only.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('incidentTrackerMachine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delegates each sync tick to the controller runSync method', async () => {
    // Use fake timers so the machine can be advanced deterministically.
    vi.useFakeTimers();

    // Expose only the controller contract that the machine should depend on.
    const runSync = vi.fn().mockResolvedValue(undefined);

    // Start the actor with a minimal polling interval and without a slot controller.
    const actor = createActor(incidentTrackerMachine, {
      input: {
        incidentTrackerController: { runSync } as unknown as IncidentTrackerController,
        slotDuration: 1,
        maxAttestationDelay: 2,
        inactiveMissedCount: 3,
      } as never,
    });

    actor.start();

    // Advance one tick so the machine enters syncing and invokes the controller.
    await vi.advanceTimersByTimeAsync(1);

    expect(runSync).toHaveBeenCalledWith({
      maxAttestationDelay: 2,
      inactiveMissedCount: 3,
    });

    actor.stop();
  });
});
