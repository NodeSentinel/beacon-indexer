import { PrismaClient, Prisma } from '@beacon-indexer/db';
import { formatInTimeZone } from 'date-fns-tz';
import ms from 'ms';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { MonthlyArchiveController } from '@/src/services/consensus/controllers/monthlyArchive.js';
import { getWeeklyArchivePartitionName } from '@/src/services/consensus/controllers/weeklyArchive.js';
import { MonthlyArchiveStorage } from '@/src/services/consensus/storage/monthlyArchive.js';

describe('Monthly Archive Process', () => {
  let prisma: PrismaClient;
  let monthlyArchiveStorage: MonthlyArchiveStorage;
  let monthlyArchiveController: MonthlyArchiveController;

  const VALIDATOR_1 = 100;
  const VALIDATOR_2 = 200;

  // Test month: November 2025 (30 days)
  // Mondays in November: Nov 3 (w45), Nov 10 (w46), Nov 17 (w47), Nov 24 (w48) = 4 weeks
  const TEST_MONTH_START = new Date('2025-11-01T00:00:00.000Z');
  const TEST_MONTH_END = new Date('2025-12-01T00:00:00.000Z');

  // Retention: lastWeek must be >= candidateMonthEnd + 1 month = Jan 1, 2026
  // Closest Monday >= Jan 1 is Jan 5 (w02)
  const RETENTION_WEEK = new Date('2026-01-05T00:00:00.000Z');

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
    // Drop all weekly archive partitions
    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    for (const p of weeklyPartitions) {
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
    await prisma.$executeRawUnsafe(`DELETE FROM validator_weekly_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_monthly_archive`);

    // Reset archive control table
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastWeek: null, lastMonth: null },
      create: { id: 1, lastWeek: null, lastMonth: null },
    });
  });

  /**
   * Helper: create a weekly archive partition and insert rows into it.
   */
  async function createWeeklyPartition(
    weekStart: Date,
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
    const partitionName = getWeeklyArchivePartitionName('validator_weekly_archive', weekStart);
    const nextWeek = new Date(weekStart.getTime() + ms('7d'));

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_weekly_archive" ` +
        `FOR VALUES FROM ('${weekStart.toISOString()}') TO ('${nextWeek.toISOString()}')`,
    );

    await prisma.validatorWeeklyArchive.createMany({
      data: rows.map((r) => ({
        timestamp: weekStart,
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
   * Helper: create weekly partitions with simple test data for consecutive weeks.
   * @param firstMonday - The Monday of the first week
   * @param weeks - Number of consecutive weeks to create
   */
  async function createWeeklyPartitionsForRange(firstMonday: Date, weeks: number): Promise<Date[]> {
    const timestamps: Date[] = [];
    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(firstMonday.getTime() + w * ms('7d'));
      timestamps.push(weekStart);
      const slot = 25380000 + w * 5040; // ~7 days worth of slots
      const epoch = 1586252 + w * 7;

      await createWeeklyPartition(weekStart, [
        {
          validatorIndex: VALIDATOR_1,
          dataBySlot: [[slot, 0, '700', '0', '0']],
          dataByEpoch: [[epoch, '70', '140', '210', '35', '0', '0', '0', '0']],
          attestationCount: 7,
          syncRewardTotal: BigInt(700),
          clRewardTotal: BigInt(455), // 70+140+210+35
          clMissedRewardTotal: BigInt(0),
        },
        {
          validatorIndex: VALIDATOR_2,
          dataBySlot: [[slot, 2, '1400', '0', '0']],
          dataByEpoch: [[epoch, '350', '420', '490', '70', '7', '14', '21', '35']],
          attestationCount: 7,
          syncRewardTotal: BigInt(1400),
          clRewardTotal: BigInt(1330), // 350+420+490+70
          clMissedRewardTotal: BigInt(77), // 7+14+21+35
        },
      ]);
    }
    return timestamps;
  }

  // First Monday in November 2025
  const FIRST_NOV_MONDAY = new Date('2025-11-03T00:00:00.000Z'); // w45

  /**
   * HAPPY PATH: Full monthly archive cycle (weekly→monthly).
   *
   * Timeline:
   *   Nov 3–24 (w45–w48)   →  4 weekly partitions (the month we want to archive)
   *   Dec 1–29 (w49–w01)   →  5 weekly partitions (retained — still in the 1-month query window)
   *   Jan 5 (w02)          →  1 extra partition (so lastWeek = Jan 5 satisfies
   *                            the retention rule: lastWeek >= candidateMonthEnd + 1 month = Jan 1)
   *
   * After archiving November:
   *   - A monthly partition `validator_monthly_archive_202511` is created with aggregated data
   *   - The 4 weekly partitions for November are dropped
   *   - The 6 remaining weekly partitions (Dec + Jan 5) stay intact
   *   - archive.lastMonth is set to Nov 1
   *
   * Verifies: aggregation sums, JSON concat + sort order, partition lifecycle, control table.
   */
  it('should aggregate weekly archives into a monthly archive, drop weekly partitions, and keep retention', async () => {
    // 4 (Nov w45-w48) + 5 (Dec w49-w01) + 1 (Jan w02) = 10 weekly partitions
    const allWeeks = await createWeeklyPartitionsForRange(FIRST_NOV_MONDAY, 10);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastWeek: RETENTION_WEEK }, // Jan 5 (w02)
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

    // Validator 1: 4 weeks × 7 attestations = 28 total
    const v1 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(28);
    expect(v1.missedAttestationCount).toBeNull();
    expect(v1.syncRewardTotal).toBe(BigInt(2800)); // 4 × 700
    expect(v1.clRewardTotal).toBe(BigInt(1820)); // 4 × 455
    expect(v1.clMissedRewardTotal).toBe(BigInt(0));

    // Validator 2: 4 weeks × 7 attestations = 28 total
    const v2 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(28);
    expect(v2.syncRewardTotal).toBe(BigInt(5600)); // 4 × 1400
    expect(v2.clRewardTotal).toBe(BigInt(5320)); // 4 × 1330
    expect(v2.clMissedRewardTotal).toBe(BigInt(308)); // 4 × 77

    // Verify JSON arrays are concatenated and sorted by first element
    const v1Slots = v1.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v1Slots).toHaveLength(4);
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0]).toBeGreaterThan(v1Slots[i - 1][0]);
    }

    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs).toHaveLength(4);
    for (let i = 1; i < v1Epochs.length; i++) {
      expect(v1Epochs[i][0]).toBeGreaterThan(v1Epochs[i - 1][0]);
    }

    // --- Verify weekly partitions for November were dropped ---
    const remainingWeeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    const remainingNames = remainingWeeklyPartitions.map((p) => p.tablename);

    // The 4 weekly partitions for November should be gone
    for (let w = 0; w < 4; w++) {
      const name = getWeeklyArchivePartitionName('validator_weekly_archive', allWeeks[w]);
      expect(remainingNames).not.toContain(name);
    }

    // The 6 remaining weekly partitions (Dec + Jan 5) should still exist
    for (let w = 4; w < 10; w++) {
      const name = getWeeklyArchivePartitionName('validator_weekly_archive', allWeeks[w]);
      expect(remainingNames).toContain(name);
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
   * RETENTION GUARD: Refuses to archive when dropping weekly partitions would leave
   * less than 1 month of weekly data for queries.
   *
   * Timeline:
   *   Nov 3–24 (w45–w48)   →  4 weekly partitions (candidate month)
   *   Dec 1–29 (w49–w01)   →  5 weekly partitions (retention, but not enough)
   *
   *   lastWeek = Dec 29 (w01).
   *   Rule: lastWeek >= candidateMonthEnd (Dec 1) + 1 month (= Jan 1, 2026).
   *   Dec 29 < Jan 1 → NOT eligible.
   */
  it('should not archive when 1-month retention window is not satisfied', async () => {
    // 4 (Nov w45-w48) + 5 (Dec w49-w01, short by 1 week to satisfy retention) = 9
    await createWeeklyPartitionsForRange(FIRST_NOV_MONDAY, 9);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastWeek: new Date('2025-12-29T00:00:00.000Z') }, // w01, < Jan 1, fails retention
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
   * candidateMonthStart = Dec 1. But December's retention window (lastWeek >= Feb 1)
   * won't be satisfied, so the second call returns null.
   */
  it('should not archive the same month twice', async () => {
    // 4 (Nov w45-w48) + 5 (Dec w49-w01) + 1 (Jan w02) = 10
    await createWeeklyPartitionsForRange(FIRST_NOV_MONDAY, 10);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastWeek: RETENTION_WEEK }, // Jan 5 (w02)
    });

    const first = await monthlyArchiveController.archive();
    expect(first).not.toBeNull();

    const second = await monthlyArchiveController.archive();
    expect(second).toBeNull();
  });

  /**
   * PARTIAL FIRST MONTH: Data starts mid-month (Nov 17, w47).
   *
   * When the indexer starts with a lookback that lands mid-month,
   * the oldest weekly partition may be mid-month (w47 = Nov 17). The controller
   * floors this to the UTC month start (Nov 1), but only 2 weekly partitions exist
   * for that month (w47, w48). Normally, a month with < 4 partitions is rejected.
   * But for the very first month (lastMonth = null), partial archiving is allowed
   * because the missing weeks don't exist — they were before the indexer started.
   *
   * Timeline:
   *   Nov 17–24 (w47–w48)  →  2 weekly partitions (partial first month)
   *   Dec 1–29 (w49–w01)   →  5 weekly partitions (retained)
   *   Jan 5 (w02)          →  1 extra partition (retention satisfied)
   *
   * After archiving: monthly record has 2 weeks of data, the 2 weekly partitions
   * are dropped, and the 6 remaining partitions (Dec + Jan 5) stay.
   */
  it('should archive a partial first month when data starts mid-month', async () => {
    const partialStart = new Date('2025-11-17T00:00:00.000Z'); // w47

    // 2 (Nov w47-w48) + 5 (Dec w49-w01) + 1 (Jan w02) = 8 weekly partitions
    const allWeeks = await createWeeklyPartitionsForRange(partialStart, 8);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastWeek: allWeeks[7] }, // Jan 5 (w02)
    });

    const archivedMonth = await monthlyArchiveController.archive();
    expect(archivedMonth).not.toBeNull();
    expect(archivedMonth!.getTime()).toBe(TEST_MONTH_START.getTime());

    // Monthly data reflects only 2 weeks
    const monthlyData = await prisma.validatorMonthlyArchive.findMany({
      where: { timestamp: TEST_MONTH_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(monthlyData).toHaveLength(2);

    const v1 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1.attestationCount).toBe(14); // 2 weeks × 7

    // The 2 weekly partitions for November were dropped
    const remainingWeeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    const remainingNames = remainingWeeklyPartitions.map((p) => p.tablename);

    for (let w = 0; w < 2; w++) {
      const name = getWeeklyArchivePartitionName('validator_weekly_archive', allWeeks[w]);
      expect(remainingNames).not.toContain(name);
    }

    // Dec (5 weeks) + Jan 5 (1 week) = 6 partitions remain
    expect(remainingNames).toHaveLength(6);
  });
});
