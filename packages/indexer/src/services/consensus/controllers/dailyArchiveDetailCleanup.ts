import { DailyArchiveDetailCleanupStorage } from '../storage/dailyArchiveDetailCleanup.js';

export type DailyArchiveDetailCleanupResult = {
  batches: number;
  rows: number;
  vacuumedPartitions: number;
};

export type DailyArchiveDetailCleanupOptions = {
  batchSize: number;
};

const DEFAULT_BATCH_SIZE = 5_000;

/**
 * DailyArchiveDetailCleanupController - Coordinates old daily archive JSON cleanup.
 */
export class DailyArchiveDetailCleanupController {
  private readonly batchSize: number;

  constructor(
    private readonly storage: DailyArchiveDetailCleanupStorage,
    options: Partial<DailyArchiveDetailCleanupOptions> = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Clean one eligible daily partition completely and vacuum it.
   *
   * Each batch commits independently through storage. The target is selected by
   * scanning current archive rows, so a restarted worker starts from database state.
   */
  async cleanupOldDailyDetails(): Promise<DailyArchiveDetailCleanupResult> {
    const target = await this.storage.findDailyArchiveDetailCleanupTarget();
    if (!target) {
      return { batches: 0, rows: 0, vacuumedPartitions: 0 };
    }

    let batches = 0;
    let rows = 0;
    let cleaned = this.batchSize;

    while (cleaned === this.batchSize) {
      cleaned = await this.storage.cleanDailyArchiveDetailBatch(target.targetDay, this.batchSize);
      if (cleaned === 0) {
        break;
      }

      batches++;
      rows += cleaned;

      if (cleaned < this.batchSize) {
        break;
      }
    }

    await this.storage.vacuumDailyArchivePartition(target.partitionName);

    return { batches, rows, vacuumedPartitions: 1 };
  }
}
