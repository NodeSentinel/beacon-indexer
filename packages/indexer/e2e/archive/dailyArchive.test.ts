import { PrismaClient, Prisma } from '@beacon-indexer/db';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { getHourlyArchivePartitionName } from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import { DailyArchiveStorage } from '@/src/services/consensus/storage/dailyArchive.js';

describe('Daily Archive Process', () => {
  let prisma: PrismaClient;
  let dailyArchiveStorage: DailyArchiveStorage;
  let dailyArchiveController: DailyArchiveController;

  const VALIDATOR_1 = 100;
  const VALIDATOR_2 = 200;

  // Test day to archive: 2025-12-16 UTC
  const TEST_DAY_START = new Date('2025-12-16T00:00:00.000Z');
  const TEST_DAY_END = new Date('2025-12-17T00:00:00.000Z');

  // The controller requires lastHour >= candidateDayEnd + 24h to ensure
  // 24h of hourly data remains after archiving. So for archiving Dec 16,
  // we need lastHour >= Dec 18 00:00.
  const RETENTION_DAY_END = new Date('2025-12-18T00:00:00.000Z');

  function createController(lookbackSlotTimestamp: number = TEST_DAY_START.getTime()) {
    dailyArchiveController = new DailyArchiveController(dailyArchiveStorage, lookbackSlotTimestamp);
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    dailyArchiveStorage = new DailyArchiveStorage(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop all hourly archive partitions
    const hourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    for (const p of hourlyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Drop all daily archive partitions
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const p of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Clean master partitioned tables
    await prisma.$executeRawUnsafe(`DELETE FROM validator_hourly_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);

    // Reset archive control table
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: null, lastDay: null },
      create: { id: 1, lastHour: null, lastDay: null },
    });

    // Default controller with lookback at day start
    createController();
  });

  /**
   * Helper: create an hourly partition and insert rows into it.
   */
  async function createHourlyPartition(
    hourTimestamp: Date,
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
    const partitionName = getHourlyArchivePartitionName('validator_hourly_archive', hourTimestamp);
    const nextHour = new Date(hourTimestamp.getTime() + 3600 * 1000);

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_hourly_archive" ` +
        `FOR VALUES FROM ('${hourTimestamp.toISOString()}') TO ('${nextHour.toISOString()}')`,
    );

    await prisma.validatorHourlyArchive.createMany({
      data: rows.map((r) => ({
        timestamp: hourTimestamp,
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
   * Helper: create hourly partitions with simple test data for a range of hours.
   */
  async function createHourlyPartitionsForRange(start: Date, hours: number): Promise<Date[]> {
    const timestamps: Date[] = [];
    for (let h = 0; h < hours; h++) {
      const hour = new Date(start.getTime() + h * 3600 * 1000);
      timestamps.push(hour);
      const slot = 25380000 + h * 720;
      const epoch = 1586252 + h;

      await createHourlyPartition(hour, [
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
   * HAPPY PATH: Full daily archive cycle.
   *
   * Timeline:
   *   Dec 16 00:00–23:00  →  24 hourly partitions (the day we want to archive)
   *   Dec 17 00:00–23:00  →  24 hourly partitions (retained — still in the 24h query window)
   *   Dec 18 00:00         →  1 extra partition (so lastHour = Dec 18 00:00 satisfies
   *                            the retention rule: lastHour >= candidateDayEnd + 24h)
   *
   * After archiving Dec 16:
   *   - A daily partition `validator_daily_archive_20251216` is created with aggregated data
   *   - The 24 hourly partitions for Dec 16 are dropped
   *   - The 25 remaining hourly partitions (Dec 17 + Dec 18 00:00) stay intact
   *   - archive.lastDay is set to Dec 16 00:00
   *
   * Verifies: aggregation sums, JSON concat + sort order, partition lifecycle, control table.
   */
  it('should aggregate hourly archives into a daily archive, drop hourly partitions, and keep the last 24h', async () => {
    const allHours = await createHourlyPartitionsForRange(TEST_DAY_START, 49);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: allHours[48] }, // Dec 18 00:00
    });

    // Verify partition discovery finds 24 partitions for the test day
    const discoveredPartitions = await dailyArchiveStorage.discoverHourlyPartitionsForDay(
      TEST_DAY_START,
      TEST_DAY_END,
    );
    expect(discoveredPartitions).toHaveLength(24);

    // Execute daily archive
    const archivedDay = await dailyArchiveController.archive();
    expect(archivedDay).not.toBeNull();
    expect(archivedDay!.getTime()).toBe(TEST_DAY_START.getTime());

    // --- Verify aggregated daily data ---
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });

    expect(dailyData).toHaveLength(2);

    // Validator 1: 24 hours × 1 attestation = 24 total
    const v1 = dailyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(24);
    expect(v1.missedAttestationCount).toBeNull(); // all NULL → SUM=0 → NULLIF=null
    expect(v1.syncRewardTotal).toBe(BigInt(2400)); // 24 × 100
    expect(v1.clRewardTotal).toBe(BigInt(1560)); // 24 × 65
    expect(v1.clMissedRewardTotal).toBe(BigInt(0));

    // Validator 2: 24 hours × 1 attestation = 24 total
    const v2 = dailyData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(24);
    expect(v2.syncRewardTotal).toBe(BigInt(4800)); // 24 × 200
    expect(v2.clRewardTotal).toBe(BigInt(4560)); // 24 × 190
    expect(v2.clMissedRewardTotal).toBe(BigInt(264)); // 24 × 11

    // Verify JSON arrays are concatenated and sorted by first element
    const v1Slots = v1.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v1Slots).toHaveLength(24);
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0]).toBeGreaterThan(v1Slots[i - 1][0]);
    }

    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs).toHaveLength(24);
    for (let i = 1; i < v1Epochs.length; i++) {
      expect(v1Epochs[i][0]).toBeGreaterThan(v1Epochs[i - 1][0]);
    }

    // --- Verify hourly partitions for the archived day were dropped ---
    const remainingHourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    const remainingNames = remainingHourlyPartitions.map((p) => p.tablename);

    // The 24 partitions for Dec 16 should be gone
    for (let h = 0; h < 24; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).not.toContain(name);
    }

    // The 25 partitions for Dec 17 + Dec 18 00:00 should still exist
    for (let h = 24; h < 49; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).toContain(name);
    }

    // --- Verify daily archive partition was created ---
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = 'validator_daily_archive_20251216'
    `;
    expect(dailyPartitions).toHaveLength(1);

    // --- Verify archive control table was updated ---
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive!.lastDay!.getTime()).toBe(TEST_DAY_START.getTime());
  });

  /**
   * RETENTION GUARD: Refuses to archive when dropping hourly partitions would leave
   * less than 24h of hourly data for the "last 24h performance" queries.
   *
   * Timeline:
   *   Dec 16 00:00–23:00  →  24 hourly partitions (candidate day)
   *   Dec 17 00:00–23:00  →  24 hourly partitions (only 23h of retention after candidate)
   *
   *   lastHour = Dec 17 23:00.
   *   Rule: lastHour >= candidateDayEnd (Dec 17 00:00) + 24h (= Dec 18 00:00).
   *   Dec 17 23:00 < Dec 18 00:00 → NOT eligible.
   *
   * If we archived Dec 16 now and someone queries "last 24h" at Dec 17 23:00,
   * the window would be Dec 16 23:00–Dec 17 23:00 — but Dec 16 data would be gone.
   * The retention guard prevents this.
   */
  it('should not archive when 24h retention window is not satisfied', async () => {
    await createHourlyPartitionsForRange(TEST_DAY_START, 48);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-17T23:00:00.000Z') },
    });

    const result = await dailyArchiveController.archive();
    expect(result).toBeNull();

    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    expect(dailyPartitions).toHaveLength(0);
  });

  /**
   * IDEMPOTENCY: Calling archive() twice for the same day is a no-op the second time.
   *
   * After the first archive() sets archive.lastDay = Dec 16, the next call computes
   * candidateDayStart = Dec 17. But Dec 17's hourly partitions were retained (not dropped),
   * and archiveExistsForDay(Dec 16) returns true because lastDay >= Dec 16.
   * The second candidate (Dec 17) won't satisfy the retention window either,
   * so the second call returns null without modifying anything.
   */
  it('should not archive the same day twice', async () => {
    await createHourlyPartitionsForRange(TEST_DAY_START, 49);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: RETENTION_DAY_END }, // Dec 18 00:00
    });

    const first = await dailyArchiveController.archive();
    expect(first).not.toBeNull();

    const second = await dailyArchiveController.archive();
    expect(second).toBeNull();
  });

  /**
   * LOOKBACK_SLOT BASE CASE: The lookback_slot day can be partial.
   *
   * When the indexer starts with a lookback_slot that doesn't align to midnight,
   * the oldest hourly partition may be mid-day (e.g., 14:00). The controller uses
   * lookbackSlotTimestamp to derive the lookback day (floored to UTC midnight),
   * and allows partial archiving for that specific day because the missing hours
   * simply don't exist — they were before the indexer started.
   *
   * Timeline:
   *   Dec 16 14:00–23:00  →  10 hourly partitions (partial first day)
   *   Dec 17 00:00–23:00  →  24 hourly partitions (retained)
   *   Dec 18 00:00         →  1 extra partition (retention satisfied)
   *
   * After archiving: daily record has 10h of data, the 10 hourly partitions are
   * dropped, and the 25 remaining partitions (Dec 17 full + Dec 18 00:00) stay.
   */
  it('should archive a partial first day when lookback_slot starts mid-day', async () => {
    const partialDayStart = new Date('2025-12-16T14:00:00.000Z');
    createController(partialDayStart.getTime());

    // 10h (Dec 16) + 24h (Dec 17) + 1h (Dec 18 00:00) = 35 partitions
    const allHours = await createHourlyPartitionsForRange(partialDayStart, 35);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: allHours[34] }, // Dec 18 00:00
    });

    const archivedDay = await dailyArchiveController.archive();
    expect(archivedDay).not.toBeNull();
    expect(archivedDay!.getTime()).toBe(TEST_DAY_START.getTime());

    // Daily data reflects only 10 hours
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(dailyData).toHaveLength(2);

    const v1 = dailyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1.attestationCount).toBe(10); // 10 hours x 1

    // The 10 hourly partitions for Dec 16 were dropped
    const remainingHourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    const remainingNames = remainingHourlyPartitions.map((p) => p.tablename);

    for (let h = 0; h < 10; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).not.toContain(name);
    }

    // Dec 17 (24h) + Dec 18 00:00 (1h) = 25 partitions remain
    expect(remainingNames).toHaveLength(25);
  });
});
