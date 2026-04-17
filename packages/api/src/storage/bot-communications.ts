import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';
import {
  type CommunicationTargeting,
  resolveCommunicationRecipients,
} from '@/storage/bot-communication-recipients.js';

export interface NotifiableCommunicationUser {
  id: string;
  telegramId: bigint;
  username: string;
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
    // Push the include and exclude filters into the query so the database trims the result set first.
    const userIdFilter =
      communication.onlyTo.length > 0 || communication.exclude.length > 0
        ? {
            ...(communication.onlyTo.length > 0 ? { in: communication.onlyTo } : {}),
            ...(communication.exclude.length > 0 ? { notIn: communication.exclude } : {}),
          }
        : undefined;

    const users = await this.prisma.user.findMany({
      where: {
        ...(userIdFilter ? { id: userIdFilter } : {}),
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

    // Keep the in-memory rule as a last line of defense for the "exclude wins" contract.
    return resolveCommunicationRecipients(users as NotifiableCommunicationUser[], communication);
  }

  /**
   * Claims one communication for sending so only one bot process can dispatch it.
   */
  async startSending(id: number) {
    const result = await this.prisma.communication.updateMany({
      where: {
        id,
        sent: false,
        sending: false,
      },
      data: {
        sending: true,
      },
    });

    return result.count === 1;
  }

  /**
   * Marks a communication as sent after a sending claim was acquired.
   */
  async markSent(id: number) {
    const result = await this.prisma.communication.updateMany({
      where: {
        id,
        sent: false,
        sending: true,
      },
      data: {
        sent: true,
        sending: false,
        sentAt: new Date(),
      },
    });

    return result.count === 1;
  }
}
