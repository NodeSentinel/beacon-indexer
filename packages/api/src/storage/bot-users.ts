import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

export class BotUsersStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async listNotifiableUsers() {
    return this.prisma.user.findMany({
      where: {
        telegramId: { not: null },
        hasBlockedBot: false,
        clusters: {
          some: {
            validators: {
              some: {},
            },
          },
        },
      },
      select: {
        id: true,
        telegramId: true,
        username: true,
        messageId: true,
      },
    });
  }

  async updateMessageId(telegramId: bigint, messageId: number) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { messageId: BigInt(messageId) },
    });
  }

  async setBlocked(telegramId: bigint) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { hasBlockedBot: true },
    });
  }

  async setUnblocked(telegramId: bigint) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { hasBlockedBot: false },
    });
  }
}
