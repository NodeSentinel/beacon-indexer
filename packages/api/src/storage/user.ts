import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * UserStorage - Database persistence layer for user operations
 */
export class UserStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Find user by session ID (stored in username for anonymous users)
   */
  async findBySessionId(sessionId: string) {
    return this.prisma.user.findFirst({
      where: { username: `anon:${sessionId}` },
      select: { id: true, username: true },
    });
  }

  /**
   * Get or create a Telegram user using upsert.
   * User.id is a cuid (auto-generated), User.telegramId stores the Telegram numeric ID.
   * Username is refreshed on every call if changed.
   */
  async getOrCreateTelegram({ telegramId, username }: { telegramId: string; username?: string }) {
    const tgId = BigInt(telegramId);

    return this.prisma.user.upsert({
      where: { telegramId: tgId },
      update: { username: username ?? undefined },
      create: {
        telegramId: tgId,
        username: username ?? `tg:${telegramId}`,
      },
      select: { id: true, username: true },
    });
  }

  /**
   * Get or create anonymous user using upsert to avoid race conditions.
   * User.id is auto-generated cuid, no telegramId.
   */
  async getOrCreateAnonymous(sessionId: string) {
    const username = `anon:${sessionId}`;

    return this.prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
      select: { id: true, username: true },
    });
  }
}
