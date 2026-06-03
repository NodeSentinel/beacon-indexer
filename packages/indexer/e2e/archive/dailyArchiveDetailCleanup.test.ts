import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DailyArchiveDetailCleanupController } from '@/src/services/consensus/controllers/dailyArchiveDetailCleanup.js';
import { DailyArchiveDetailCleanupStorage } from '@/src/services/consensus/storage/dailyArchiveDetailCleanup.js';

describe('Daily Archive Detail Cleanup Process', () => {
  let prisma: PrismaClient;
  let cleanupController: DailyArchiveDetailCleanupController;

  const ARCHIVED_DAY = new Date('2025-12-16T00:00:00.000Z');
  const OLDEST_DAY = new Date('2025-11-30T00:00:00.000Z');
  const OLD_DAY = new Date('2025-12-01T00:00:00.000Z');
  const RETAINED_DAY = new Date('2025-12-02T00:00:00.000Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Create the Prisma client used by the e2e database.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    // Create the cleanup controller with small e2e batches for deterministic assertions.
    cleanupController = new DailyArchiveDetailCleanupController(
      new DailyArchiveDetailCleanupStorage(prisma, 14),
      {
        batchSize: 2,
      },
    );
  });

  afterAll(async () => {
    // Close the Prisma connection after all cleanup e2e tests finish.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop daily archive partitions so each test owns the cleanup target rows.
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const p of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Clean parent rows and set the latest completed daily archive boundary.
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastDay: ARCHIVED_DAY },
      create: { id: 1, lastDay: ARCHIVED_DAY },
    });
  });

  /**
   * Creates one daily archive partition and inserts rows with JSON detail.
   */
  async function createDailyArchiveRows(timestamp: Date, validatorCount: number): Promise<void> {
    const partitionName = `validator_daily_archive_${timestamp.toISOString().slice(0, 10).replaceAll('-', '')}`;
    const nextDay = new Date(timestamp.getTime() + 24 * 3600 * 1000);

    // Create the physical daily partition that cleanup should scan.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_daily_archive" ` +
        `FOR VALUES FROM ('${timestamp.toISOString()}') TO ('${nextDay.toISOString()}')`,
    );

    // Insert rows that have detailed JSON and aggregate columns.
    await prisma.validatorDailyArchive.createMany({
      data: Array.from({ length: validatorCount }, (_, index) => ({
        timestamp,
        validatorIndex: 1000 + index,
        dataBySlot: [[1, 0]],
        dataByEpoch: [[1, '1', '1', '1', '1', '0', '0', '0', '0']],
        attestationCount: 1,
        syncRewardTotal: BigInt(0),
        syncMissedRewardTotal: BigInt(0),
        clRewardTotal: BigInt(4),
        clMissedRewardTotal: BigInt(0),
      })),
    });
  }

  /**
   * Creates one detached daily WIP table with rows that cleanup must not scan.
   */
  async function createDailyArchiveWipRows(
    timestamp: Date,
    validatorCount: number,
  ): Promise<string> {
    const partitionName = `validator_daily_archive_wip_${timestamp.toISOString().slice(0, 10).replaceAll('-', '')}`;
    const nextDay = new Date(timestamp.getTime() + 24 * 3600 * 1000);
    const rangeConstraintName = `${partitionName}_timestamp_check`;

    // Create a standalone WIP table that mirrors daily archive shape but is not attached.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" ` +
        `(LIKE "validator_daily_archive" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
    );

    // Add the same timestamp range check required before eventual partition attach.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${partitionName}" ADD CONSTRAINT "${rangeConstraintName}" ` +
        `CHECK ("timestamp" >= '${timestamp.toISOString()}'::timestamp ` +
        `AND "timestamp" < '${nextDay.toISOString()}'::timestamp)`,
    );

    // Insert old JSON detail directly into the detached WIP table.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${partitionName}" (
        timestamp,
        validator_index,
        data_by_slot,
        data_by_epoch,
        attestation_count,
        sync_reward_total,
        sync_missed_reward_total,
        cl_reward_total,
        cl_missed_reward_total
      )
      SELECT
        '${timestamp.toISOString()}'::timestamp,
        2000 + generate_series,
        '[[1, 0]]'::jsonb,
        '[[1, "1", "1", "1", "1", "0", "0", "0", "0"]]'::jsonb,
        1,
        0,
        0,
        4,
        0
      FROM generate_series(0, ${validatorCount - 1})`,
    );

    return partitionName;
  }

  /**
   * Counts cleaned and remaining JSON detail rows for one daily archive timestamp.
   */
  async function countDetailRows(timestamp: Date): Promise<{ cleaned: number; remaining: number }> {
    const [counts] = await prisma.$queryRaw<Array<{ cleaned: number; remaining: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE data_by_slot IS NULL AND data_by_epoch IS NULL)::int AS cleaned,
        COUNT(*) FILTER (WHERE data_by_slot IS NOT NULL OR data_by_epoch IS NOT NULL)::int AS remaining
      FROM validator_daily_archive
      WHERE "timestamp" = ${timestamp}::timestamp
    `;
    return counts;
  }

  /**
   * CLEANUP COMPLETION: Cleans one old daily partition in bounded batches.
   *
   * The cleanup worker runs independently from daily archiving. Each wake fully
   * clears one selected day before vacuuming that partition.
   */
  it('cleans one old daily partition completely using bounded batches', async () => {
    // Create old rows outside the 14-day retention window.
    await createDailyArchiveRows(OLD_DAY, 5);

    // Create retained rows exactly at the cutoff so they must keep JSON detail.
    await createDailyArchiveRows(RETAINED_DAY, 3);

    // Run one cleanup pass with batchSize=2 so the day needs three committed batches.
    const result = await cleanupController.cleanupOldDailyDetails();
    expect(result).toEqual({ batches: 3, rows: 5, vacuumedPartitions: 1 });

    // Verify the whole old partition was cleaned by this wake.
    await expect(countDetailRows(OLD_DAY)).resolves.toEqual({ cleaned: 5, remaining: 0 });

    // Verify rows inside the retention window still keep JSON detail.
    await expect(countDetailRows(RETAINED_DAY)).resolves.toEqual({ cleaned: 0, remaining: 3 });

    // Verify aggregate columns remain available after cleanup.
    const [cleanedRow] = await prisma.$queryRaw<Array<{ cl_reward_total: bigint }>>`
      SELECT cl_reward_total
      FROM validator_daily_archive
      WHERE "timestamp" = ${OLD_DAY}::timestamp
        AND data_by_slot IS NULL
        AND data_by_epoch IS NULL
      ORDER BY validator_index ASC
      LIMIT 1
    `;
    expect(cleanedRow.cl_reward_total).toBe(BigInt(4));
  });

  /**
   * ONE-DAY SCOPE: Each cleanup wake finishes one day and leaves later old days for later wakes.
   */
  it('continues cleanup on later runs with the next old daily partition', async () => {
    // Create two old daily partitions so the test can observe one-day-per-wake behavior.
    await createDailyArchiveRows(OLDEST_DAY, 3);
    await createDailyArchiveRows(OLD_DAY, 2);

    // Run the first cleanup pass so only the oldest partition is completed and vacuumed.
    const firstResult = await cleanupController.cleanupOldDailyDetails();
    expect(firstResult).toEqual({ batches: 2, rows: 3, vacuumedPartitions: 1 });
    await expect(countDetailRows(OLDEST_DAY)).resolves.toEqual({ cleaned: 3, remaining: 0 });
    await expect(countDetailRows(OLD_DAY)).resolves.toEqual({ cleaned: 0, remaining: 2 });

    // Run the second cleanup pass so the next old partition is processed.
    const result = await cleanupController.cleanupOldDailyDetails();

    // Verify later wakes continue from the next old partition, not from already-vacuumed days.
    expect(result).toEqual({ batches: 1, rows: 2, vacuumedPartitions: 1 });
    await expect(countDetailRows(OLD_DAY)).resolves.toEqual({ cleaned: 2, remaining: 0 });
  });

  /**
   * WIP ISOLATION: Cleanup scans only published daily archive partitions.
   */
  it('does not clean detached WIP daily archive rows', async () => {
    // Create published old rows that the cleanup worker is allowed to clean.
    await createDailyArchiveRows(OLD_DAY, 2);

    // Create detached old WIP rows that are outside the parent partition tree.
    const wipPartitionName = await createDailyArchiveWipRows(OLD_DAY, 2);

    // Run cleanup so only parent-visible rows are eligible.
    const result = await cleanupController.cleanupOldDailyDetails();
    expect(result).toEqual({ batches: 1, rows: 2, vacuumedPartitions: 1 });

    // Verify published rows were cleaned normally.
    await expect(countDetailRows(OLD_DAY)).resolves.toEqual({ cleaned: 2, remaining: 0 });

    // Verify detached WIP rows keep their JSON detail.
    const [wipCounts] = await prisma.$queryRawUnsafe<Array<{ remaining: number }>>(
      `SELECT COUNT(*)::int AS remaining FROM "${wipPartitionName}" ` +
        `WHERE data_by_slot IS NOT NULL AND data_by_epoch IS NOT NULL`,
    );
    expect(wipCounts.remaining).toBe(2);
  });
});
