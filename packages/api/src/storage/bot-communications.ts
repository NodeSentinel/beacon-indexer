import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

export interface CommunicationTargeting {
  exclude: string[];
  onlyTo: string[];
}

export interface NotifiableCommunicationUser {
  id: string;
  telegramId: bigint;
  username: string;
}

/**
 * Resolves the final audience for a communication.
 */
export function resolveCommunicationRecipients<T extends { id: string }>(
  users: T[],
  targeting: CommunicationTargeting,
): T[] {
  // Use sets so the inclusion and exclusion checks stay simple and predictable.
  const excludedUserIds = new Set(targeting.exclude);
  const onlyUserIds = new Set(targeting.onlyTo);

  return users.filter((user) => {
    // Exclusion always wins, even when the user also appears in onlyTo.
    if (excludedUserIds.has(user.id)) return false;

    // When onlyTo is empty, every notifiable user is eligible.
    if (onlyUserIds.size === 0) return true;

    // When onlyTo has values, only the listed users are eligible.
    return onlyUserIds.has(user.id);
  });
}

/**
 * Stores and resolves broadcast communications used by the Telegram bot.
 */
export class BotCommunicationsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Creates a new communication in pending state.
   */
  async create(input: {
    description: string;
    message: string;
    exclude: string[];
    onlyTo: string[];
  }) {
    return this.prisma.communication.create({
      data: {
        description: input.description,
        message: input.message,
        exclude: input.exclude,
        onlyTo: input.onlyTo,
      },
    });
  }

  /**
   * Gets one communication by numeric id.
   */
  async findById(id: number) {
    return this.prisma.communication.findUnique({
      where: { id },
    });
  }

  /**
   * Lists all notifiable users and applies the communication targeting rules.
   */
  async listRecipients(communication: CommunicationTargeting) {
    const users = await this.prisma.user.findMany({
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
      },
    });

    return resolveCommunicationRecipients(users as NotifiableCommunicationUser[], communication);
  }

  /**
   * Marks a communication as sent only once.
   */
  async markSent(id: number) {
    const result = await this.prisma.communication.updateMany({
      where: {
        id,
        sent: false,
      },
      data: {
        sent: true,
        sentAt: new Date(),
      },
    });

    return result.count === 1;
  }
}
