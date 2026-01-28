import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * SystemConfigStorage - Database persistence layer for system configuration tables
 * Handles all database operations for helper/config tables like Archive and IndexerConfig
 * No business logic here - only data access
 */

interface ArchiveRow {
  id: number;
  last_hour: Date | null;
  last_day: Date | null;
  last_week: Date | null;
  last_month: Date | null;
}

interface IndexerConfigRow {
  id: number;
  chain: string;
  lookback_slot: number;
  created_at: Date;
}

export class SystemConfigStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Get archive configuration
   * @returns Archive row or null if not found
   */
  async getArchive(): Promise<ArchiveRow | null> {
    const result = await this.prisma.$queryRaw<ArchiveRow[]>`
      SELECT
        id,
        last_hour,
        last_day,
        last_week,
        last_month
      FROM archive
      WHERE id = 1
      LIMIT 1
    `;

    return result[0] ?? null;
  }

  /**
   * Get indexer configuration
   * @returns IndexerConfig row or null if not found
   */
  async getIndexerConfig(): Promise<IndexerConfigRow | null> {
    const result = await this.prisma.$queryRaw<IndexerConfigRow[]>`
      SELECT
        id,
        chain,
        lookback_slot,
        created_at
      FROM indexer_config
      WHERE id = 1
      LIMIT 1
    `;

    return result[0] ?? null;
  }
}
