import { PrismaClient } from '@beacon-indexer/db';

/**
 * Stores broadcast communications used by the Telegram bot.
 */
export class BotCommunicationsStorage {
  constructor(private readonly prisma: PrismaClient) {}

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
   * Lists communications that have not been sent yet.
   */
  async listPending() {
    return this.prisma.communication.findMany({
      where: {
        sent: false,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Lists the telegram ids eligible for a full broadcast send.
   */
  async listBroadcastTelegramIds() {
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
        telegramId: true,
      },
    });

    // Convert database bigint values into telegram ids the bot can send to directly.
    return users.map((user) => user.telegramId!.toString());
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
