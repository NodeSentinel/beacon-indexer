import { describe, expect, it, vi } from 'vitest';

import { UserStorage } from './user.js';

/**
 * Extracts SQL text from a Prisma.sql object used by raw storage operations.
 */
function getSqlText(queryArg: unknown): string {
  if (queryArg && typeof queryArg === 'object' && 'sql' in queryArg) {
    return (queryArg as { sql: string }).sql;
  }

  return '';
}

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

  it('lists distinct withdrawal addresses from validators in clusters owned by the user', async () => {
    // This scenario verifies claim addresses come from validators owned through clusters.
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { withdrawalAddress: '0x0000000000000000000000000000000000000001' },
        { withdrawalAddress: '0x0000000000000000000000000000000000000002' },
      ]);
    const storage = new UserStorage({ validator: { findMany } } as never);

    // Loads all non-null withdrawal addresses for validators in authenticated user clusters.
    const result = await storage.listOwnedClusterWithdrawalAddresses('user-a');

    // Confirms storage returns the address strings consumed by the claim service.
    expect(result).toEqual([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    // Confirms Prisma applies owner scoping through cluster membership and distinct address selection.
    expect(findMany).toHaveBeenCalledWith({
      where: {
        clusters: {
          some: {
            cluster: {
              ownerId: 'user-a',
            },
          },
        },
        withdrawalAddress: { not: null },
      },
      select: { withdrawalAddress: true },
      distinct: ['withdrawalAddress'],
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

  it('clears claimable snapshot rows for claimed withdrawal addresses', async () => {
    // This scenario ensures the API claim path removes stale claimable amounts immediately after claim.
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const storage = new UserStorage({ $executeRaw: executeRaw } as never);
    const withdrawalAddresses = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ];

    // Clears the claimable snapshot cache for the exact addresses sent to the claim contract.
    await storage.clearClaimableWithdrawalAddresses(withdrawalAddresses);

    // Confirms storage deletes only from the withdrawal-address claimable snapshot table.
    const sql = getSqlText(executeRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('DELETE FROM withdrawal_address_claimable_snapshot');
    expect(sql).toContain('WHERE withdrawal_address IN');
    // Confirms the delete is parameterized with the lowercased claimed withdrawal addresses.
    expect(executeRaw.mock.calls[0]?.[0].values).toEqual(withdrawalAddresses);
  });
});
