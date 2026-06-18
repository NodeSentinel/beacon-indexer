import { IndexerConfigStorage } from '@/src/services/consensus/storage/indexerConfig.js';

/**
 * IndexerConfigController - Business logic for indexer configuration validation
 *
 * This controller handles validation and initialization of indexer configuration.
 * It ensures that the database is only used with the same chain and lookbackSlot
 * configuration to prevent data corruption.
 */
export class IndexerConfigController {
  constructor(private readonly indexerConfigStorage: IndexerConfigStorage) {}

  /**
   * Validate or initialize the indexer configuration
   *
   * If no configuration exists in the database, it creates one with the provided values.
   * If configuration exists, it validates that the provided chain and lookbackSlot match
   * the stored values. Throws an error if there's a mismatch.
   *
   * @param chain - The chain name (e.g., 'ethereum', 'gnosis')
   * @param lookbackSlot - The lookback slot value
   * @throws Error if configuration exists and doesn't match the provided values
   */
  async validateOrInitializeConfig(chain: string, lookbackSlot: number): Promise<void> {
    const existingConfig = await this.indexerConfigStorage.getIndexerConfig();

    if (!existingConfig) {
      // No configuration exists, create it with the provided values
      await this.indexerConfigStorage.createIndexerConfig(chain, lookbackSlot);
      return;
    }

    // Configuration exists, validate that it matches
    if (existingConfig.chain !== chain || existingConfig.lookbackSlot !== lookbackSlot) {
      throw new Error(
        `Indexer configuration mismatch! Database is configured for chain='${existingConfig.chain}' with lookbackSlot=${existingConfig.lookbackSlot}, but current configuration is chain='${chain}' with lookbackSlot=${lookbackSlot}. This would corrupt the database. Please use the correct configuration or reset the database.`,
      );
    }
  }
}
