import { PrismaClient } from '@beacon-indexer/db';
import { formatInTimeZone } from 'date-fns-tz';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getWeeklyArchivePartitionName } from '@/src/services/consensus/controllers/weeklyArchive.js';
import { WeeklyArchiveController } from '@/src/services/consensus/controllers/weeklyArchive.js';
import { WeeklyArchiveStorage } from '@/src/services/consensus/storage/weeklyArchive.js';

describe('Weekly Archive Process', () => {
  let prisma: PrismaClient;
  let weeklyArchiveStorage: WeeklyArchiveStorage;
  let weeklyArchiveController: WeeklyArchiveController;

  // Test week: Mon Dec 15, 2025 to Sun Dec 21, 2025 (ISO week 51)
  const TEST_WEEK_START = new Date('2025-12-15T00:00:00.000Z'); // Monday

  // Test validators
  const VALIDATOR_1 = 100;
  const VALIDATOR_2 = 200;

  // Per-day test data generators
  // Each day gets: 1 slot tuple and 1 epoch tuple
  // Slot tuple: [slot, attestation_delay, sync_reward, exec_reward, block_reward]
  // Epoch tuple: [epoch, head, target, source, inactivity, missedHead, missedTarget, missedSource, missedInactivity]
  function makeSlotTuple(slot: number): [number, number, string, string, string] {
    return [slot, 0, '100', '0', '0'];
  }

  function makeEpochTuple(
    epoch: number,
  ): [number, string, string, string, string, string, string, string, string] {
    return [epoch, '10', '20', '30', '5', '0', '0', '0', '0'];
  }

  function makeSlotTupleV2(slot: number): [number, number, string, string, string] {
    return [slot, 0, '200', '0', '0'];
  }

  function makeEpochTupleV2(
    epoch: number,
  ): [number, string, string, string, string, string, string, string, string] {
    return [epoch, '50', '60', '70', '10', '1', '2', '3', '5'];
  }

  /**
   * Create a single daily archive partition and insert rows for 2 validators.
   * @param dayTimestamp - The UTC day start
   * @param slotBase - Base slot number (unique per day)
   * @param epochBase - Base epoch number (unique per day)
   */
  async function createDailyPartition(
    dayTimestamp: Date,
    slotBase: number,
    epochBase: number,
  ): Promise<void> {
    const suffix = formatInTimeZone(dayTimestamp, 'UTC', 'yyyyMMdd');
    const partitionName = `validator_daily_archive_${suffix}`;
    const nextDay = new Date(dayTimestamp.getTime() + 24 * 3600 * 1000);

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_daily_archive" ` +
        `FOR VALUES FROM ('${dayTimestamp.toISOString()}') TO ('${nextDay.toISOString()}')`,
    );

    // VALIDATOR_1: attestationCount=1, syncRewardTotal=100, clRewardTotal=65 (10+20+30+5), clMissedRewardTotal=0
    // VALIDATOR_2: attestationCount=1, syncRewardTotal=200, clRewardTotal=190 (50+60+70+10), clMissedRewardTotal=11 (1+2+3+5)
    await prisma.validatorDailyArchive.createMany({
      data: [
        {
          timestamp: dayTimestamp,
          validatorIndex: VALIDATOR_1,
          dataBySlot: [makeSlotTuple(slotBase)],
          dataByEpoch: [makeEpochTuple(epochBase)],
          attestationCount: 1,
          missedAttestationCount: null,
          syncRewardTotal: BigInt(100),
          execRewardTotal: null,
          blockRewardTotal: null,
          clRewardTotal: BigInt(65),
          clMissedRewardTotal: BigInt(0),
        },
        {
          timestamp: dayTimestamp,
          validatorIndex: VALIDATOR_2,
          dataBySlot: [makeSlotTupleV2(slotBase + 1)],
          dataByEpoch: [makeEpochTupleV2(epochBase + 1)],
          attestationCount: 1,
          missedAttestationCount: null,
          syncRewardTotal: BigInt(200),
          execRewardTotal: null,
          blockRewardTotal: null,
          clRewardTotal: BigInt(190),
          clMissedRewardTotal: BigInt(11),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
  }

  /**
   * Create daily partitions for a range of consecutive days.
   * @param start - The first day
   * @param days - Number of consecutive days to create
   * @param slotBaseStart - Starting slot base (incremented by 100 per day)
   * @param epochBaseStart - Starting epoch base (incremented by 100 per day)
   */
  async function createDailyPartitionsForRange(
    start: Date,
    days: number,
    slotBaseStart = 1000,
    epochBaseStart = 100,
  ): Promise<void> {
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
      await createDailyPartition(day, slotBaseStart + i * 100, epochBaseStart + i * 100);
    }
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    weeklyArchiveStorage = new WeeklyArchiveStorage(prisma);
    weeklyArchiveController = new WeeklyArchiveController(weeklyArchiveStorage);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop all daily archive partitions
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const partition of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    // Drop all weekly archive partitions
    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    for (const partition of weeklyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    // Clean master tables
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_weekly_archive`);

    // Reset archive control table
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastDay: null, lastWeek: null },
      create: { id: 1, lastDay: null, lastWeek: null },
    });
  });

  /**
   * HAPPY PATH: Full 7-day week with retention satisfied.
   *
   * Creates 7 daily partitions for the test week (Dec 15-21) plus 8 retention
   * days (Dec 22-29) for a total of 15 days starting from Dec 15.
   * Sets lastDay = Dec 29 which satisfies the retention guard
   * (Dec 29 >= Dec 22 + 7 days = Dec 29).
   *
   * Verifies:
   * - Weekly archive partition (validator_weekly_archive_2025w51) is created
   * - Aggregated data is correct (7x per-day values)
   * - JSON arrays are concatenated and sorted by slot/epoch
   * - 7 daily partitions for the week are dropped
   * - Retention days (Dec 22-29) remain
   * - archive.lastWeek is updated
   */
  it('should archive weekly data correctly (happy path)', async () => {
    // Create 15 daily partitions: Dec 15 to Dec 29
    await createDailyPartitionsForRange(TEST_WEEK_START, 15);

    // Set lastDay = Dec 29 (satisfies retention: Dec 29 - Dec 22 = 7 days >= 7 days)
    const lastDay = new Date('2025-12-29T00:00:00.000Z');
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay },
    });

    // Execute archive
    const result = await weeklyArchiveController.archive();

    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(TEST_WEEK_START.getTime());

    // Verify weekly archive partition was created
    const expectedPartitionName = getWeeklyArchivePartitionName(
      'validator_weekly_archive',
      TEST_WEEK_START,
    );
    expect(expectedPartitionName).toBe('validator_weekly_archive_2025w51');

    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename = ${expectedPartitionName}
    `;
    expect(weeklyPartitions.length).toBe(1);

    // Verify aggregated data
    const archivedData = await prisma.validatorWeeklyArchive.findMany({
      where: { timestamp: TEST_WEEK_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(archivedData.length).toBe(2);

    // VALIDATOR_1: 7 days * per-day values
    const v1 = archivedData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(7); // 7 * 1
    expect(v1.syncRewardTotal).toBe(BigInt(700)); // 7 * 100
    expect(v1.clRewardTotal).toBe(BigInt(455)); // 7 * 65
    expect(v1.clMissedRewardTotal).toBe(BigInt(0)); // 7 * 0

    // VALIDATOR_2: 7 days * per-day values
    const v2 = archivedData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(7); // 7 * 1
    expect(v2.syncRewardTotal).toBe(BigInt(1400)); // 7 * 200
    expect(v2.clRewardTotal).toBe(BigInt(1330)); // 7 * 190
    expect(v2.clMissedRewardTotal).toBe(BigInt(77)); // 7 * 11

    // Verify JSON arrays are concatenated and sorted
    const v1Slots = v1.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v1Slots.length).toBe(7);
    // Verify sorted by slot (first element of each tuple)
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0]).toBeGreaterThan(v1Slots[i - 1][0]);
    }

    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs.length).toBe(7);
    for (let i = 1; i < v1Epochs.length; i++) {
      expect(v1Epochs[i][0]).toBeGreaterThan(v1Epochs[i - 1][0]);
    }

    const v2Slots = v2.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v2Slots.length).toBe(7);
    for (let i = 1; i < v2Slots.length; i++) {
      expect(v2Slots[i][0]).toBeGreaterThan(v2Slots[i - 1][0]);
    }

    // Verify 7 daily partitions for the week are dropped
    const remainingDailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_daily_archive_%'
      ORDER BY tablename
    `;
    // Should have 8 remaining (Dec 22-29, the retention days)
    expect(remainingDailyPartitions.length).toBe(8);
    // None of the week's partitions should remain
    const weekPartitionNames = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(TEST_WEEK_START.getTime() + i * 24 * 3600 * 1000);
      const suffix = formatInTimeZone(day, 'UTC', 'yyyyMMdd');
      weekPartitionNames.push(`validator_daily_archive_${suffix}`);
    }
    for (const name of weekPartitionNames) {
      expect(remainingDailyPartitions.map((p) => p.tablename)).not.toContain(name);
    }

    // Verify archive.lastWeek is updated
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive!.lastWeek).not.toBeNull();
    expect(archive!.lastWeek!.getTime()).toBe(TEST_WEEK_START.getTime());
  });

  /**
   * RETENTION GUARD: Week data exists but retention window is not satisfied.
   *
   * Creates 14 days of daily partitions (7 for the week + 6 retention days),
   * but sets lastDay = Dec 27 which is less than the required Dec 29
   * (candidateWeekEnd + 7 days = Dec 22 + 7 = Dec 29).
   *
   * Expects the controller to return null (no archive).
   */
  it('should not archive when retention window is not satisfied', async () => {
    // Create 14 daily partitions: Dec 15 to Dec 28 (7 + 6 retention, short by 1)
    await createDailyPartitionsForRange(TEST_WEEK_START, 14);

    // Set lastDay = Dec 27 (does NOT satisfy retention: Dec 27 - Dec 22 = 5 days < 7 days)
    const lastDay = new Date('2025-12-27T00:00:00.000Z');
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay },
    });

    // Execute archive
    const result = await weeklyArchiveController.archive();

    expect(result).toBeNull();

    // Verify no weekly partitions were created
    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    expect(weeklyPartitions.length).toBe(0);

    // Verify all daily partitions still exist
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    expect(dailyPartitions.length).toBe(14);
  });

  /**
   * IDEMPOTENCY: Archiving twice returns null on the second call.
   *
   * Performs a full archive, then calls archive() again. The second call
   * should detect the week was already archived (via archiveExistsForWeek)
   * and return null without creating duplicate data.
   */
  it('should return null on second archive call (idempotency)', async () => {
    // 7 days (week to archive) + 8 days (retention) = 15 daily partitions: Dec 15 to Dec 29
    await createDailyPartitionsForRange(TEST_WEEK_START, 15);

    // Set lastDay = Dec 29 (satisfies retention: >= Dec 22 + 7 days)
    const lastDay = new Date('2025-12-29T00:00:00.000Z');
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay },
    });

    // First archive - should succeed
    const result1 = await weeklyArchiveController.archive();
    expect(result1).not.toBeNull();
    expect(result1!.getTime()).toBe(TEST_WEEK_START.getTime());

    // Second archive - should return null (already archived / next week not eligible)
    const result2 = await weeklyArchiveController.archive();
    expect(result2).toBeNull();

    // Verify only one weekly partition exists
    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    expect(weeklyPartitions.length).toBe(1);
  });

  /**
   * PARTIAL FIRST WEEK: Data starts mid-week (Wednesday Dec 17).
   *
   * Simulates starting data collection on a Wednesday. The first week
   * only has 5 daily partitions (Wed-Sun, Dec 17-21) instead of the
   * usual 7. The controller should still archive this partial first week
   * because isFirstWeek=true bypasses the 7-partition requirement.
   *
   * lastDay is set to satisfy retention (>= Dec 29).
   */
  it('should archive partial first week when data starts mid-week', async () => {
    // Start from Wednesday Dec 17 (mid-week)
    const partialStart = new Date('2025-12-17T00:00:00.000Z');
    // 5 days for the week (Dec 17-21) + 8 retention days (Dec 22-29)
    await createDailyPartitionsForRange(partialStart, 13);

    // Set lastDay = Dec 29 (satisfies retention)
    const lastDay = new Date('2025-12-29T00:00:00.000Z');
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay },
    });

    // Execute archive
    const result = await weeklyArchiveController.archive();

    expect(result).not.toBeNull();
    // The week start should still be floored to Monday Dec 15
    expect(result!.getTime()).toBe(TEST_WEEK_START.getTime());

    // Verify weekly archive partition was created
    const weeklyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_weekly_archive_%'
    `;
    expect(weeklyPartitions.length).toBe(1);
    expect(weeklyPartitions[0].tablename).toBe('validator_weekly_archive_2025w51');

    // Verify aggregated data has 5 days worth (not 7)
    const archivedData = await prisma.validatorWeeklyArchive.findMany({
      where: { timestamp: TEST_WEEK_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(archivedData.length).toBe(2);

    // VALIDATOR_1: 5 days * per-day values
    const v1 = archivedData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1).toBeDefined();
    expect(v1.attestationCount).toBe(5); // 5 * 1
    expect(v1.syncRewardTotal).toBe(BigInt(500)); // 5 * 100
    expect(v1.clRewardTotal).toBe(BigInt(325)); // 5 * 65

    // VALIDATOR_2: 5 days * per-day values
    const v2 = archivedData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(5); // 5 * 1
    expect(v2.syncRewardTotal).toBe(BigInt(1000)); // 5 * 200
    expect(v2.clRewardTotal).toBe(BigInt(950)); // 5 * 190
    expect(v2.clMissedRewardTotal).toBe(BigInt(55)); // 5 * 11

    // Verify JSON arrays have 5 entries each
    const v1Slots = v1.dataBySlot as Array<[number, number, string, string, string]>;
    expect(v1Slots.length).toBe(5);

    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs.length).toBe(5);

    // Verify only the 5 daily partitions for the week portion (Dec 17-21) are dropped
    const remainingDailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE tablename LIKE 'validator_daily_archive_%'
      ORDER BY tablename
    `;
    // Should have 8 remaining (Dec 22-29, the retention days)
    expect(remainingDailyPartitions.length).toBe(8);

    // Verify archive.lastWeek is updated
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive!.lastWeek).not.toBeNull();
    expect(archive!.lastWeek!.getTime()).toBe(TEST_WEEK_START.getTime());
  });
});
