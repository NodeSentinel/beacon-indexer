import { PrismaClient } from '@beacon-indexer/db';
import { subDays } from 'date-fns';

export type DailyArchiveDetailCleanupTarget = {
  targetDay: Date;
  partitionName: string;
};

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
   * Find the oldest daily partition with JSON detail outside retention.
   *
   * Cleanup is intentionally stateless. If the process restarts, the next wake
   * scans the archive table again and picks the oldest day that still has JSON.
   */
  async findDailyArchiveDetailCleanupTarget(): Promise<DailyArchiveDetailCleanupTarget | null> {
    const cleanupCutoff = await this.getCleanupCutoff();
    if (!cleanupCutoff) {
      return null;
    }

    const [target] = await this.prisma.$queryRaw<
      Array<{
        target_day: Date;
        partition_name: string;
      }>
    >`
      SELECT
        archive."timestamp" AS target_day,
        archive.tableoid::regclass::text AS partition_name
      FROM validator_daily_archive archive
      WHERE archive."timestamp" < ${cleanupCutoff}::timestamp
        AND (archive.data_by_slot IS NOT NULL OR archive.data_by_epoch IS NOT NULL)
      ORDER BY archive."timestamp" ASC, archive.validator_index ASC
      LIMIT 1
    `;

    if (!target) {
      return null;
    }

    return {
      targetDay: target.target_day,
      partitionName: target.partition_name,
    };
  }

  /**
   * Clear JSON detail from one bounded set of rows for a single daily partition.
   *
   * The batch size limits row locks per cleanup pass. The query only targets
   * rows that still have JSON detail, so restarted cleanup skips null rows.
   */
  async cleanDailyArchiveDetailBatch(targetDay: Date, batchSize: number): Promise<number> {
    const [result] = await this.prisma.$queryRaw<Array<{ cleaned: number }>>`
      WITH rows_to_clean AS (
        SELECT tableoid, ctid
        FROM validator_daily_archive
        WHERE "timestamp" = ${targetDay}::timestamp
          AND (data_by_slot IS NOT NULL OR data_by_epoch IS NOT NULL)
        ORDER BY validator_index ASC
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

  /**
   * Run VACUUM FULL on the finished daily archive partition.
   */
  async vacuumDailyArchivePartition(partitionName: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`VACUUM FULL ${quotePostgresIdentifier(partitionName)}`);
  }
}

/**
 * Quote a daily archive partition identifier after rejecting unsafe table names.
 */
function quotePostgresIdentifier(identifier: string): string {
  if (!/^validator_daily_archive_\d{8}$/.test(identifier)) {
    throw new Error(`Unsafe daily archive partition name: ${identifier}`);
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}
