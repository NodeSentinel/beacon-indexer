import { describe, expect, it, vi } from 'vitest';

import { SlotStorage } from './slot.js';

// This suite verifies storage-level caching for repeated slot metadata reads.
describe('SlotStorage', () => {
  // This test verifies sync committee validators are loaded once for concurrent epoch reads.
  it('coalesces concurrent sync committee validator reads for the same epoch', async () => {
    // This prisma stub returns one sync committee validator list.
    const prisma = {
      syncCommittee: {
        findFirst: vi.fn().mockResolvedValue({ validators: ['1', '2'] }),
      },
    };

    // This storage instance exercises the real LRU fetch cache around the prisma call.
    const storage = new SlotStorage(prisma as never);

    // These calls simulate slot processing and prefetch requesting the same epoch validators.
    const [firstResult, secondResult] = await Promise.all([
      storage.getSyncCommitteeValidators(10),
      storage.getSyncCommitteeValidators(10),
    ]);

    // This assertion verifies both callers receive the same validator list.
    expect(firstResult).toEqual(secondResult);

    // This assertion verifies only one database lookup was made for the epoch.
    expect(prisma.syncCommittee.findFirst).toHaveBeenCalledTimes(1);
  });
});
