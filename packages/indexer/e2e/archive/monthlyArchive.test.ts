import { PrismaClient, Prisma } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getDailyArchivePartitionName } from '@/src/services/consensus/controllers/dailyArchive.js';
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

  // Retention: lastDay must be >= candidateMonthEnd + 30 days = Dec 31
  const RETENTION_DAY = new Date('2025-12-31T00:00:00.000Z');

  function createController(lookbackSlotTimestamp: number = TEST_MONTH_START.getTime()) {
    monthlyArchiveController = new MonthlyArchiveController(
      monthlyArchiveStorage,
      lookbackSlotTimestamp,
    );
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    monthlyArchiveStorage = new MonthlyArchiveStorage(prisma);
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

    // Default controller with lookback at month start
    createController();
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
    const partitionName = getDailyArchivePartitionName('validator_daily_archive', dayTimestamp);
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
      const slot = 25380000 + d * 7200;
      const epoch = 1586252 + d;

      await createDailyPartition(day, [
        {
          validatorIndex: VALIDATOR_1,
          dataBySlot: [[slot, 0, '100', '0', '0']],
          dataByEpoch: [[epoch, '10', '20', '30', '5', '0', '0', '0', '0']],
          attestationCount: 24,
          syncRewardTotal: BigInt(2400),
          clRewardTotal: BigInt(1560),
          clMissedRewardTotal: BigInt(0),
        },
        {
          validatorIndex: VALIDATOR_2,
          dataBySlot: [[slot, 2, '200', '0', '0']],
          dataByEpoch: [[epoch, '50', '60', '70', '10', '5', '3', '2', '1']],
          attestationCount: 24,
          syncRewardTotal: BigInt(4800),
          clRewardTotal: BigInt(4560),
          clMissedRewardTotal: BigInt(264),
        },
      ]);
    }
    return timestamps;
  }

  /**
   * HAPPY PATH: Full monthly archive cycle (daily→monthly).
   *
   * Timeline:
   *   Nov 1–30  →  30 daily partitions (the month we want to archive)
   *   Dec 1–31  →  31 daily partitions (retained — still in the 30-day query window)
   *
   *   lastDay = Dec 31.
   *   Rule: lastDay >= candidateMonthEnd (Dec 1) + 30 days (= Dec 31).
   *   Dec 31 >= Dec 31 → eligible.
   *
   * After archiving November:
   *   - A monthly partition `validator_monthly_archive_202511` is created
   *   - The 30 daily partitions for November are dropped
   *   - The 31 remaining daily partitions (December) stay intact
   *   - archive.lastMonth is set to Nov 1
   */
  it('should aggregate daily archives into a monthly archive, drop daily partitions, and keep retention', async () => {
    // 30 (Nov) + 31 (Dec) = 61 daily partitions
    const allDays = await createDailyPartitionsForRange(TEST_MONTH_START, 61);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: RETENTION_DAY }, // Dec 31
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

    // Validator 1: 30 days × 24 attestations = 720 total
    const v1 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(720);
    expect(v1.missedAttestationCount).toBeNull();
    expect(v1.syncRewardTotal).toBe(BigInt(72000)); // 30 × 2400
    expect(v1.clRewardTotal).toBe(BigInt(46800)); // 30 × 1560
    expect(v1.clMissedRewardTotal).toBe(BigInt(0));

    // Validator 2: 30 days × 24 attestations = 720 total
    const v2 = monthlyData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(720);
    expect(v2.syncRewardTotal).toBe(BigInt(144000)); // 30 × 4800
    expect(v2.clRewardTotal).toBe(BigInt(136800)); // 30 × 4560
    expect(v2.clMissedRewardTotal).toBe(BigInt(7920)); // 30 × 264

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

    // The 30 daily partitions for November should be gone
    for (let d = 0; d < 30; d++) {
      const name = getDailyArchivePartitionName('validator_daily_archive', allDays[d]);
      expect(remainingNames).not.toContain(name);
    }

    // The 31 daily partitions for December should still exist
    for (let d = 30; d < 61; d++) {
      const name = getDailyArchivePartitionName('validator_daily_archive', allDays[d]);
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
   * RETENTION GUARD: Refuses to archive when dropping daily partitions would leave
   * less than 30 days of daily data for queries.
   *
   * Timeline:
   *   Nov 1–30  →  30 daily partitions (candidate month)
   *   Dec 1–29  →  29 daily partitions (not enough retention)
   *
   *   lastDay = Dec 29.
   *   Rule: lastDay >= candidateMonthEnd (Dec 1) + 30 days (= Dec 31).
   *   Dec 29 < Dec 31 → NOT eligible.
   */
  it('should not archive when 30-day retention window is not satisfied', async () => {
    // 30 (Nov) + 29 (Dec, short) = 59
    await createDailyPartitionsForRange(TEST_MONTH_START, 59);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: new Date('2025-12-29T00:00:00.000Z') },
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
   */
  it('should not archive the same month twice', async () => {
    await createDailyPartitionsForRange(TEST_MONTH_START, 61);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: RETENTION_DAY },
    });

    const first = await monthlyArchiveController.archive();
    expect(first).not.toBeNull();

    const second = await monthlyArchiveController.archive();
    expect(second).toBeNull();
  });

  /**
   * LOOKBACK_SLOT BASE CASE: The lookback_slot month can be partial.
   *
   * When the indexer starts with a lookback_slot that falls mid-month (e.g., Nov 15),
   * the controller uses lookbackSlotTimestamp to derive the lookback month (floored to
   * Nov 1), and allows partial archiving for that specific month because the missing
   * days simply don't exist — they were before the indexer started.
   *
   * Timeline:
   *   Nov 15–30  →  16 daily partitions (partial first month)
   *   Dec 1–31   →  31 daily partitions (retained)
   *
   * After archiving: monthly record has 16 days of data, the 16 daily partitions
   * are dropped, and the 31 remaining partitions (December) stay.
   */
  it('should archive a partial first month when lookback_slot starts mid-month', async () => {
    const partialMonthStart = new Date('2025-11-15T00:00:00.000Z');
    createController(partialMonthStart.getTime());

    // 16 (Nov 15-30) + 31 (Dec) = 47 daily partitions
    const allDays = await createDailyPartitionsForRange(partialMonthStart, 47);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: allDays[46] }, // Dec 31
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
    expect(v1.attestationCount).toBe(384); // 16 days × 24

    // The 16 daily partitions for November were dropped
    const remainingDailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    const remainingNames = remainingDailyPartitions.map((p) => p.tablename);

    for (let d = 0; d < 16; d++) {
      const name = getDailyArchivePartitionName('validator_daily_archive', allDays[d]);
      expect(remainingNames).not.toContain(name);
    }

    // Dec (31 days) remain
    expect(remainingNames).toHaveLength(31);
  });
});
