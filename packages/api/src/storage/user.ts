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
   * Get or create anonymous user
   */
  async getOrCreateAnonymous(sessionId: string) {
    const existing = await this.findBySessionId(sessionId);
    if (existing) {
      return existing;
    }
    return this.createAnonymous(sessionId);
  }
}
