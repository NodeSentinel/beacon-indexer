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
   * Create an anonymous user
   * Uses a deterministic BigInt ID based on the session UUID
   */
  async createAnonymous(sessionId: string) {
    // Generate a deterministic BigInt from the UUID
    // Take first 15 hex chars from UUID (60 bits) to stay within safe integer range
    const hexPart = sessionId.replace(/-/g, '').slice(0, 15);
    const userId = BigInt(`0x${hexPart}`);

    return this.prisma.user.create({
      data: {
        id: userId,
        userId: userId,
        username: `anon:${sessionId}`,
      },
      select: { id: true, username: true },
    });
  }

  /**
   * Get or create a Telegram user using upsert.
   * Both User.id and User.userId are set to the Telegram numeric ID as BigInt.
   * Username is refreshed on every call if changed.
   */
  async getOrCreateTelegram({ telegramId, username }: { telegramId: string; username?: string }) {
    const tgId = BigInt(telegramId);

    return this.prisma.user.upsert({
      where: { userId: tgId },
      // Refresh username if it changed; undefined means "don't update"
      update: { username: username ?? undefined },
      create: {
        id: tgId,
        userId: tgId,
        username: username ?? `tg:${telegramId}`,
      },
      select: { id: true, username: true },
    });
  }

  /**
   * Get or create anonymous user using upsert to avoid race conditions
   */
  async getOrCreateAnonymous(sessionId: string) {
    // Generate a deterministic BigInt from the UUID
    const hexPart = sessionId.replace(/-/g, '').slice(0, 15);
    const genUserId = BigInt(`0x${hexPart}`);
    const username = `anon:${sessionId}`;

    return this.prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        id: genUserId,
        userId: genUserId,
        username,
      },
      select: { id: true, username: true },
    });
  }
}
