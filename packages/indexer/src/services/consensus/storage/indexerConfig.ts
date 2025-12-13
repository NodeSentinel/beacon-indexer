import { PrismaClient } from '@beacon-indexer/db';

/**
 * IndexerConfigStorage - Database persistence layer for indexer configuration
 *
 * This class handles all database operations for indexer configuration, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, validation, and processing happens in the controller layer.
 */
export class IndexerConfigStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retrieve the stored indexer configuration
   * @returns The stored configuration or null if it doesn't exist
   */
  async getIndexerConfig() {
    return this.prisma.indexerConfig.findUnique({
      where: { id: 1 },
    });
  }

  /**
   * Create the initial indexer configuration
   * @param chain - The chain name (e.g., 'ethereum', 'gnosis')
   * @param lookbackSlot - The lookback slot value
   */
  async createIndexerConfig(chain: string, lookbackSlot: number) {
    await this.prisma.indexerConfig.create({
      data: {
        id: 1,
        chain,
        lookbackSlot,
      },
    });
  }
}
