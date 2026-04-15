import { describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusController } from './validatorActivityStatus.js';

// Silence logger output so the test can focus on controller behavior.
vi.mock('@/src/lib/pino.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
  })),
}));

describe('ValidatorActivityStatusController', () => {
  it('uses the smaller limit between the indexed slot and the safe distance from head', async () => {
    // Expose only the storage method that should receive the computed slot limit.
    const storage = {
      syncCurrentActivityStatus: vi.fn().mockResolvedValue(undefined),
    };

    // The controller reads the last indexed slot from storage.
    const slotStorage = {
      getLastProcessedSlot: vi.fn().mockResolvedValue(120),
    };

    // Head is slightly ahead, but we still keep a distance from it.
    const beaconTime = {
      getChainCurrentSlot: vi.fn().mockReturnValue(100),
    };

    const controller = new ValidatorActivityStatusController(
      storage as never,
      slotStorage as never,
      beaconTime as never,
    );

    // head - distanceToHead = 98, so the head-side limit is smaller than the
    // indexed slot. After the attestation delay, the last safe slot becomes 95.
    await controller.runSync({
      skipValidatorStatusUpdateWhenBehindHeadSlots: 2,
      maxAttestationDelay: 3,
      inactiveMissedCount: 4,
    });

    expect(storage.syncCurrentActivityStatus).toHaveBeenCalledWith({
      newestProcessableSlot: 95,
      inactiveMissedCount: 4,
      maxAttestationDelay: 3,
    });
  });
});
