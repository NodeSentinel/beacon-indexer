import { SystemConfigStorage } from '@/storage/systemConfig.js';

/**
 * SystemConfigController - Business logic layer for system configuration operations
 * Orchestrates data retrieval from system config/helper tables
 */

interface Archive {
  lastHour: Date | null;
  lastDay: Date | null;
  lastMonth: Date | null;
}

interface IndexerConfig {
  chain: string;
  lookbackSlot: number;
  createdAt: Date;
}

export class SystemConfigController {
  constructor(private readonly storage: SystemConfigStorage) {}

  /**
   * Get archive configuration
   * @returns Archive configuration or null if not found
   */
  async getArchive(): Promise<Archive | null> {
    const row = await this.storage.getArchive();
    if (!row) {
      return null;
    }

    return {
      lastHour: row.last_hour,
      lastDay: row.last_day,
      lastMonth: row.last_month,
    };
  }

  /**
   * Get indexer configuration
   * @returns IndexerConfig or null if not found
   */
  async getIndexerConfig(): Promise<IndexerConfig | null> {
    const row = await this.storage.getIndexerConfig();
    if (!row) {
      return null;
    }

    return {
      chain: row.chain,
      lookbackSlot: row.lookback_slot,
      createdAt: row.created_at,
    };
  }
}
