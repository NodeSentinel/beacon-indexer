import { PrismaClient } from '@beacon-indexer/db';
import { subDays } from 'date-fns';

/**
 * DailyArchiveDetailCleanupStorage - Database operations for daily archive JSON cleanup.
 */
export class DailyArchiveDetailCleanupStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly archiveDetailRetentionDays: number,
  ) {}

  /**
   * Read the newest day that finished hourly-to-daily archiving.
   */
  async getLastArchivedDay(): Promise<Date | null> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastDay: true },
    });

    return archive?.lastDay ?? null;
  }

  /**
   * Compute the oldest day that should still keep daily JSON detail.
   *
   * Rows before this timestamp can lose data_by_slot and data_by_epoch because
   * aggregate columns remain available for historical queries.
   */
  async getCleanupCutoff(): Promise<Date | null> {
    const lastDay = await this.getLastArchivedDay();
    if (!lastDay) {
      return null;
    }

    return subDays(lastDay, this.archiveDetailRetentionDays);
  }

  /**
   * Clear JSON detail from one bounded set of old daily archive rows.
   *
   * The batch size limits row locks per cleanup pass. The query only targets
   * rows that still have JSON detail, so already-cleaned rows are skipped.
   */
  async cleanOldDailyArchiveDetailBatch(batchSize: number): Promise<number> {
    const cleanupCutoff = await this.getCleanupCutoff();
    if (!cleanupCutoff) {
      return 0;
    }

    const [result] = await this.prisma.$queryRaw<Array<{ cleaned: number }>>`
      WITH rows_to_clean AS (
        SELECT tableoid, ctid
        FROM validator_daily_archive
        WHERE "timestamp" < ${cleanupCutoff}::timestamp
          AND (data_by_slot IS NOT NULL OR data_by_epoch IS NOT NULL)
        ORDER BY "timestamp" ASC, validator_index ASC
        LIMIT ${batchSize}
      ),
      updated_rows AS (
        UPDATE validator_daily_archive archive
        SET data_by_slot = NULL, data_by_epoch = NULL
        FROM rows_to_clean
        WHERE archive.tableoid = rows_to_clean.tableoid
          AND archive.ctid = rows_to_clean.ctid
        RETURNING 1
      )
      SELECT COUNT(*)::int AS cleaned FROM updated_rows
    `;

    return result.cleaned;
  }
}
