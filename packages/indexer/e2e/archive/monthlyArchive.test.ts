import { PrismaClient, Prisma } from '@beacon-indexer/db';
import { formatInTimeZone } from 'date-fns-tz';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { MonthlyArchiveStorage } from '@/src/services/consensus/storage/monthlyArchive.js';

describe('Monthly Archive Process', () => {
  let prisma: PrismaClient;
  let monthlyArchiveStorage: MonthlyArchiveStorage;
  let monthlyArchiveController: MonthlyArchiveController;

  const VALIDATOR_1 = 100;
  const VALIDATOR_2 = 200;

  // Test month: November 2025 (30 days)
  const TEST_MONTH_START = new Date('2025-11-01T00:00:00.000Z');
  const TEST_MONTH_END = new Date('2025-12-01T00:00:00.000Z');

  // Retention: lastDay must be >= candidateMonthEnd + 1 month = Jan 1, 2026
  const RETENTION_END = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    monthlyArchiveStorage = new MonthlyArchiveStorage(prisma);
    monthlyArchiveController = new MonthlyArchiveController(monthlyArchiveStorage);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop all daily archive partitions
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const p of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Drop all monthly archive partitions
    const monthlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_monthly_archive_%'
    `;
    for (const p of monthlyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Clean master partitioned tables
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_monthly_archive`);

    // Reset archive control table
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastDay: null, lastMonth: null },
      create: { id: 1, lastDay: null, lastMonth: null },
    });
  });

  /**
   * Helper: create a daily archive partition and insert rows into it.
   */
  async function createDailyPartition(
    dayTimestamp: Date,
    rows: Array<{
      validatorIndex: number;
      dataBySlot: Prisma.InputJsonValue;
      dataByEpoch: Prisma.InputJsonValue;
      attestationCount: number;
      missedAttestationCount?: number | null;
      syncRewardTotal: bigint;
      execRewardTotal?: string | null;
      blockRewardTotal?: bigint | null;
      clRewardTotal: bigint;
      clMissedRewardTotal: bigint;
    }>,
  ): Promise<void> {
    const suffix = formatInTimeZone(dayTimestamp, 'UTC', 'yyyyMMdd');
    const partitionName = `validator_daily_archive_${suffix}`;
    const nextDay = new Date(dayTimestamp.getTime() + 24 * 3600 * 1000);

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_daily_archive" ` +
        `FOR VALUES FROM ('${dayTimestamp.toISOString()}') TO ('${nextDay.toISOString()}')`,
    );

    await prisma.validatorDailyArchive.createMany({
      data: rows.map((r) => ({
        timestamp: dayTimestamp,
        validatorIndex: r.validatorIndex,
        dataBySlot: r.dataBySlot,
        dataByEpoch: r.dataByEpoch,
        attestationCount: r.attestationCount,
        missedAttestationCount: r.missedAttestationCount ?? null,
        syncRewardTotal: r.syncRewardTotal,
        execRewardTotal: r.execRewardTotal ?? null,
        blockRewardTotal: r.blockRewardTotal ?? null,
        clRewardTotal: r.clRewardTotal,
        clMissedRewardTotal: r.clMissedRewardTotal,
      })),
    });
  }

  /**
   * Helper: create daily partitions with simple test data for a range of days.
   */
  async function createDailyPartitionsForRange(start: Date, days: number): Promise<Date[]> {
    const timestamps: Date[] = [];
    for (let d = 0; d < days; d++) {
      const day = new Date(start.getTime() + d * 24 * 3600 * 1000);
      timestamps.push(day);
      const slot = 25380000 + d * 720;
      const epoch = 1586252 + d;

      await createDailyPartition(day, [
        {
          validatorIndex: VALIDATOR_1,
          dataBySlot: [[slot, 0, '100', '0', '0']],
          dataByEpoch: [[epoch, '10', '20', '30', '5', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(100),
          clRewardTotal: BigInt(65), // 10+20+30+5
          clMissedRewardTotal: BigInt(0),
        },
        {
          validatorIndex: VALIDATOR_2,
          dataBySlot: [[slot, 2, '200', '0', '0']],
          dataByEpoch: [[epoch, '50', '60', '70', '10', '5', '3', '2', '1']],
          attestationCount: 1,
          syncRewardTotal: BigInt(200),
          clRewardTotal: BigInt(190), // 50+60+70+10
          clMissedRewardTotal: BigInt(11), // 5+3+2+1
        },
      ]);
    }
    return timestamps;
  }

  /**
   * HAPPY PATH: Full monthly archive cycle.
   *
   * Timeline:
   *   Nov 1–30   →  30 daily partitions (the month we want to archive)
   *   Dec 1–31   →  31 daily partitions (retained — still in the 1-month query window)
   *   Jan 1      →  1 extra partition (so lastDay = Jan 1 satisfies
   *                  the retention rule: lastDay >= candidateMonthEnd + 1 month = Jan 1)
   *
   * After archiving November:
   *   - A monthly partition `validator_monthly_archive_202511` is created with aggregated data
   *   - The 30 daily partitions for November are dropped
   *   - The 32 remaining daily partitions (Dec 1–31 + Jan 1) stay intact
   *   - archive.lastMonth is set to Nov 1
   *
   * Verifies: aggregation sums, JSON concat + sort order, partition lifecycle, control table.
   */
  it('should aggregate daily archives into a monthly archive, drop daily partitions, and keep retention', async () => {
    // 30 (Nov) + 31 (Dec) + 1 (Jan 1) = 62 daily partitions
    const allDays = await createDailyPartitionsForRange(TEST_MONTH_START, 62);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: RETENTION_END }, // Jan 1, 2026
    });

    // Execute monthly archive
    const archivedMonth = await monthlyArchiveController.archive();
    expect(archivedMonth).not.toBeNull();
    expect(archivedMonth!.getTime()).toBe(TEST_MONTH_START.getTime());

    // --- Verify aggregated monthly data ---
    const monthlyData = await prisma.validatorMonthlyArchive.findMany({
      where: { timestamp: TEST_MONTH_START },
      orderBy: { validatorIndex: 'asc' },
    });

    expect(monthlyData).toHaveLength(2);

    // Validator 1: 30 days × 1 attestation = 30 total
    const v1 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(30);
    expect(v1.missedAttestationCount).toBeNull();
    expect(v1.syncRewardTotal).toBe(BigInt(3000)); // 30 × 100
    expect(v1.clRewardTotal).toBe(BigInt(1950)); // 30 × 65
    expect(v1.clMissedRewardTotal).toBe(BigInt(0));

    // Validator 2: 30 days × 1 attestation = 30 total
    const v2 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(30);
    expect(v2.syncRewardTotal).toBe(BigInt(6000)); // 30 × 200
    expect(v2.clRewardTotal).toBe(BigInt(5700)); // 30 × 190
    expect(v2.clMissedRewardTotal).toBe(BigInt(330)); // 30 × 11

    // Verify JSON arrays are concatenated and sorted by first element
    const v1Slots = v1.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v1Slots).toHaveLength(30);
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0]).toBeGreaterThan(v1Slots[i - 1][0]);
    }

    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs).toHaveLength(30);
    for (let i = 1; i < v1Epochs.length; i++) {
      expect(v1Epochs[i][0]).toBeGreaterThan(v1Epochs[i - 1][0]);
    }

    // --- Verify daily partitions for November were dropped ---
    const remainingDailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    const remainingNames = remainingDailyPartitions.map((p) => p.tablename);

    // The 30 partitions for November should be gone
    for (let d = 0; d < 30; d++) {
      const suffix = formatInTimeZone(allDays[d], 'UTC', 'yyyyMMdd');
      expect(remainingNames).not.toContain(`validator_daily_archive_${suffix}`);
    }

    // The 32 partitions for Dec + Jan 1 should still exist
    for (let d = 30; d < 62; d++) {
      const suffix = formatInTimeZone(allDays[d], 'UTC', 'yyyyMMdd');
      expect(remainingNames).toContain(`validator_daily_archive_${suffix}`);
    }

    // --- Verify monthly archive partition was created ---
    const monthlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = 'validator_monthly_archive_202511'
    `;
    expect(monthlyPartitions).toHaveLength(1);

    // --- Verify archive control table was updated ---
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive!.lastMonth!.getTime()).toBe(TEST_MONTH_START.getTime());
  });

  /**
   * RETENTION GUARD: Refuses to archive when dropping daily partitions would leave
   * less than 1 month of daily data for queries.
   *
   * Timeline:
   *   Nov 1–30   →  30 daily partitions (candidate month)
   *   Dec 1–30   →  30 daily partitions (only 30 days of retention after candidate)
   *
   *   lastDay = Dec 30.
   *   Rule: lastDay >= candidateMonthEnd (Dec 1) + 1 month (= Jan 1, 2026).
   *   Dec 30 < Jan 1 → NOT eligible.
   *
   * If we archived November now and someone queries "last month" on Dec 30,
   * the window would include Nov 30 — but November data would be gone.
   * The retention guard prevents this.
   */
  it('should not archive when 1-month retention window is not satisfied', async () => {
    // 30 (Nov) + 30 (Dec 1-30, not enough) = 60 daily partitions
    await createDailyPartitionsForRange(TEST_MONTH_START, 60);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: new Date('2025-12-30T00:00:00.000Z') },
    });

    const result = await monthlyArchiveController.archive();
    expect(result).toBeNull();

    const monthlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_monthly_archive_%'
    `;
    expect(monthlyPartitions).toHaveLength(0);
  });

  /**
   * IDEMPOTENCY: Calling archive() twice for the same month is a no-op the second time.
   *
   * After the first archive() sets archive.lastMonth = Nov 1, the next call computes
   * candidateMonthStart = Dec 1. But December's retention window (lastDay >= Feb 1)
   * won't be satisfied, so the second call returns null.
   */
  it('should not archive the same month twice', async () => {
    await createDailyPartitionsForRange(TEST_MONTH_START, 62);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: RETENTION_END },
    });

    const first = await monthlyArchiveController.archive();
    expect(first).not.toBeNull();

    const second = await monthlyArchiveController.archive();
    expect(second).toBeNull();
  });

  /**
   * LOOKBACK BASE CASE: The very first month can be partial.
   *
   * When the indexer starts mid-month (e.g., Nov 15), the oldest daily partition
   * is Nov 15. The controller floors this to Nov 1 but only 16 daily partitions
   * exist (Nov 15–30). Normally, a month with < 30 partitions is rejected.
   * But for the very first month (lastMonth = null), partial archiving is allowed
   * because the missing days simply don't exist — they were before the indexer started.
   *
   * Timeline:
   *   Nov 15–30   →  16 daily partitions (partial first month)
   *   Dec 1–31    →  31 daily partitions (retained)
   *   Jan 1       →  1 extra partition (retention satisfied)
   *
   * After archiving: monthly record has 16 days of data, the 16 daily partitions
   * are dropped, and the 32 remaining partitions (Dec + Jan 1) stay.
   */
  it('should archive a partial first month when data starts mid-month', async () => {
    const partialMonthStart = new Date('2025-11-15T00:00:00.000Z');

    // 16 (Nov 15-30) + 31 (Dec) + 1 (Jan 1) = 48 daily partitions
    const allDays = await createDailyPartitionsForRange(partialMonthStart, 48);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: allDays[47] }, // Jan 1, 2026
    });

    const archivedMonth = await monthlyArchiveController.archive();
    expect(archivedMonth).not.toBeNull();
    expect(archivedMonth!.getTime()).toBe(TEST_MONTH_START.getTime());

    // Monthly data reflects only 16 days
    const monthlyData = await prisma.validatorMonthlyArchive.findMany({
      where: { timestamp: TEST_MONTH_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(monthlyData).toHaveLength(2);

    const v1 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1.attestationCount).toBe(16); // 16 days × 1

    // The 16 daily partitions for Nov 15-30 were dropped
    const remainingDailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    const remainingNames = remainingDailyPartitions.map((p) => p.tablename);

    for (let d = 0; d < 16; d++) {
      const suffix = formatInTimeZone(allDays[d], 'UTC', 'yyyyMMdd');
      expect(remainingNames).not.toContain(`validator_daily_archive_${suffix}`);
    }

    // Dec (31) + Jan 1 (1) = 32 partitions remain
    expect(remainingNames).toHaveLength(32);
  });
});
