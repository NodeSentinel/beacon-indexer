import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

export class BotNotificationsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async listPending(limit: number) {
    return this.prisma.notificationQueue.findMany({
      where: {
        delivered: false,
        user: {
          telegramId: { not: null },
          hasBlockedBot: false,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        type: true,
        payload: true,
        createdAt: true,
        user: {
          select: {
            telegramId: true,
          },
        },
      },
    });
  }

  async markDelivered(id: string) {
    return this.prisma.notificationQueue.update({
      where: { id },
      data: {
        delivered: true,
        deliveredAt: new Date(),
      },
    });
  }

  async delete(id: string) {
    return this.prisma.notificationQueue.delete({
      where: { id },
    });
  }
}
