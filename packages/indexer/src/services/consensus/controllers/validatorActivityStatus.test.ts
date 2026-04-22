import { describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusController } from './validatorActivityStatus.js';

// Silence logger output so the test can focus on controller behavior.
vi.mock('@/src/lib/pino.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
  })),
}));

describe('ValidatorActivityStatusController', () => {
  it('processes up to the newest slot already marked as processed', async () => {
    // Expose only the storage method that should receive the computed slot limit.
    const storage = {
      syncCurrentActivityStatus: vi.fn().mockResolvedValue(undefined),
    };

    // The controller reads the newest fully processed slot from slot storage.
    const slotStorage = {
      getLastProcessedSlot: vi.fn().mockResolvedValue(120),
    };

    const controller = new ValidatorActivityStatusController(
      storage as never,
      slotStorage as never,
    );

    // The activity sync should trust the slot pipeline and avoid adding another
    // head delay after slot processing has completed.
    await controller.syncCurrentActivityStatus({
      maxAttestationDelay: 3,
      inactiveMissedCount: 4,
    });

    expect(storage.syncCurrentActivityStatus).toHaveBeenCalledWith({
      newestEvaluableDutySlot: 117,
      inactiveMissedCount: 4,
      maxAttestationDelay: 3,
    });
  });
});
