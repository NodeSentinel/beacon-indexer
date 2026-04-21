import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

export class BotNotificationsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Lists queued validator notifications for bot delivery. */
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

  /** Marks a queued validator notification as delivered. */
  async markDelivered(id: string) {
    return this.prisma.notificationQueue.update({
      where: { id },
      data: {
        delivered: true,
        deliveredAt: new Date(),
      },
    });
  }

  /** Deletes a regular queued notification. */
  async delete(id: string) {
    return this.prisma.notificationQueue.delete({
      where: { id },
    });
  }
}
