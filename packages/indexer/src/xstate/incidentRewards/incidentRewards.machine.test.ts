import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { incidentRewardsMachine } from './incidentRewards.machine.js';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';

// Stub logging so the test verifies only the machine-controller boundary.
vi.mock('@/src/xstate/pinoLog.js', () => ({
  pinoLog: vi.fn(() => () => {}),
}));

describe('incidentRewardsMachine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delegates each periodic sweep to the controller runSync method', async () => {
    // Use fake timers so the fixed half-hour sweep can be triggered instantly.
    vi.useFakeTimers();

    // Expose only the method the machine should invoke.
    const runSync = vi.fn().mockResolvedValue(undefined);

    // Start the actor without wiring a slot controller into the machine input.
    const actor = createActor(incidentRewardsMachine, {
      input: {
        incidentRewardsController: { runSync } as unknown as IncidentRewardsController,
      } as never,
    });

    actor.start();

    // Advance one scheduled sweep so the controller sync is invoked once.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(runSync).toHaveBeenCalledTimes(1);

    actor.stop();
  });
});
