import { describe, expect, it, vi } from 'vitest';

import { UserStorage } from './user.js';

describe('UserStorage user context', () => {
  it('returns only user identity when resolving the current user', async () => {
    // This case verifies authenticated user context excludes cluster-level Lido CSM state.
    const user = { id: 'user-a', username: 'alice' };
    const upsert = vi.fn().mockResolvedValue(user);
    const storage = new UserStorage({ user: { upsert } } as never);

    // Resolves a Telegram user through the same path used by secured routes.
    const result = await storage.getOrCreateTelegram({ telegramId: '123', username: 'alice' });

    // Confirms callers receive identity data without any cluster-owned fields.
    expect(result).toEqual(user);
    // Confirms Prisma selects only fields owned by user identity.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, username: true },
      }),
    );
  });
});

describe('UserStorage claim data', () => {
  it('selects Telegram id and cooldown fields for claim checks', async () => {
    // This scenario verifies claim logic reads only the user fields needed for eligibility.
    const claimUser = { id: 'user-a', telegramId: 123n, lastClaimed: null };
    const findUnique = vi.fn().mockResolvedValue(claimUser);
    const storage = new UserStorage({ user: { findUnique } } as never);

    // Loads the claim-specific user state by the authenticated API user id.
    const result = await storage.findClaimUserById('user-a');

    // Confirms claim checks can distinguish Telegram users from anonymous users.
    expect(result).toEqual(claimUser);
    // Confirms Prisma does not read unrelated user columns for this route.
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      select: { id: true, telegramId: true, lastClaimed: true },
    });
  });

  it('lists distinct fee recipient addresses from clusters owned by the user', async () => {
    // This scenario verifies claim addresses come from owned cluster fee recipients.
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { feeRecipientAddress: '0x0000000000000000000000000000000000000001' },
        { feeRecipientAddress: '0x0000000000000000000000000000000000000002' },
      ]);
    const storage = new UserStorage({ cluster: { findMany } } as never);

    // Loads all non-null fee recipient addresses for the authenticated user clusters.
    const result = await storage.listOwnedClusterFeeRecipientAddresses('user-a');

    // Confirms storage returns the address strings consumed by the claim service.
    expect(result).toEqual([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    // Confirms Prisma applies owner scoping, null filtering, and distinct address selection.
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: 'user-a', feeRecipientAddress: { not: null } },
      select: { feeRecipientAddress: true },
      distinct: ['feeRecipientAddress'],
    });
  });

  it('updates lastClaimed after a successful claim transaction', async () => {
    // This scenario verifies cooldown state is written only through an explicit claim method.
    const claimedAt = new Date('2026-01-10T12:00:00.000Z');
    const update = vi.fn().mockResolvedValue(undefined);
    const storage = new UserStorage({ user: { update } } as never);

    // Records the timestamp of a successful transaction for the current user.
    await storage.updateLastClaimed('user-a', claimedAt);

    // Confirms the storage write is scoped by user id and only changes lastClaimed.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { lastClaimed: claimedAt },
    });
  });
});
