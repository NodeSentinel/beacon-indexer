import { DailyArchiveDetailCleanupStorage } from '../storage/dailyArchiveDetailCleanup.js';

export type DailyArchiveDetailCleanupResult = {
  batches: number;
  rows: number;
};

export type DailyArchiveDetailCleanupOptions = {
  batchSize: number;
  maxBatchesPerRun: number;
};

const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES_PER_RUN = 100;

/**
 * DailyArchiveDetailCleanupController - Coordinates old daily archive JSON cleanup.
 */
export class DailyArchiveDetailCleanupController {
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;

  constructor(
    private readonly storage: DailyArchiveDetailCleanupStorage,
    options: Partial<DailyArchiveDetailCleanupOptions> = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxBatchesPerRun = options.maxBatchesPerRun ?? DEFAULT_MAX_BATCHES_PER_RUN;
  }

  /**
   * Run cleanup batches until there is no work or this wake reaches its budget.
   *
   * The budget prevents a large backlog from turning one cleanup wake into a
   * long database job. Later wakes continue from rows that still have JSON.
   */
  async cleanupOldDailyDetails(): Promise<DailyArchiveDetailCleanupResult> {
    let batches = 0;
    let rows = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const cleaned = await this.storage.cleanOldDailyArchiveDetailBatch(this.batchSize);
      if (cleaned === 0) {
        break;
      }

      batches++;
      rows += cleaned;

      if (cleaned < this.batchSize) {
        break;
      }
    }

    return { batches, rows };
  }
}
