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

  // This test verifies a missing sync committee row is not cached as an empty validator list.
  it('queries sync committee validators again after an initial missing row', async () => {
    // This prisma stub simulates a period-boundary lookup before and after storage is ready.
    const prisma = {
      syncCommittee: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ validators: ['3', '4'] }),
      },
    };

    // This storage instance exercises the real LRU fetch cache around the prisma call.
    const storage = new SlotStorage(prisma as never);

    // This first lookup happens before the sync committee row exists.
    const missingResult = await storage.getSyncCommitteeValidators(20);

    // This second lookup happens after the sync committee row has been stored.
    const storedResult = await storage.getSyncCommitteeValidators(20);

    // This assertion keeps the caller-facing fallback for a fresh database miss.
    expect(missingResult).toEqual([]);

    // This assertion verifies the second lookup sees the stored validators.
    expect(storedResult).toEqual(['3', '4']);

    // This assertion verifies the missing database result was not cached.
    expect(prisma.syncCommittee.findFirst).toHaveBeenCalledTimes(2);
  });
});
