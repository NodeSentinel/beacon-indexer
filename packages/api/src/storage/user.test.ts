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
