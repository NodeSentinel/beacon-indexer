import { Prisma, PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

    dailyArchiveStorage = new DailyArchiveStorage(prisma, 14);
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
    await prisma.$executeRawUnsafe(`DELETE FROM archive_hour_merge_progress`);

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
      syncMissedRewardTotal?: bigint;
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
        syncMissedRewardTotal: r.syncMissedRewardTotal ?? BigInt(0),
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
          dataBySlot: [[slot, 0, '100']],
          dataByEpoch: [[epoch, '10', '20', '30', '5', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(100),
          clRewardTotal: BigInt(65), // 10+20+30+5
          clMissedRewardTotal: BigInt(0),
        },
        {
          validatorIndex: VALIDATOR_2,
          dataBySlot: [[slot, 2, '200']],
          dataByEpoch: [[epoch, '50', '60', '70', '10', '5', '3', '2', '1']],
          attestationCount: 1,
          syncRewardTotal: BigInt(200),
          syncMissedRewardTotal: BigInt(25),
          clRewardTotal: BigInt(190), // 50+60+70+10
          clMissedRewardTotal: BigInt(11), // 5+3+2+1
        },
      ]);
    }
    return timestamps;
  }

  /**
   * Helper: create a daily partition with one row that still has JSON detail.
   */
  async function createOldDailyArchiveWithDetail(timestamp: Date): Promise<void> {
    const partitionName = `validator_daily_archive_${timestamp.toISOString().slice(0, 10).replaceAll('-', '')}`;
    const nextDay = new Date(timestamp.getTime() + 24 * 3600 * 1000);

    // Create the physical daily partition that cleanup should update.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_daily_archive" ` +
        `FOR VALUES FROM ('${timestamp.toISOString()}') TO ('${nextDay.toISOString()}')`,
    );

    // Insert a daily row with detail that should be removed after retention expires.
    await prisma.validatorDailyArchive.create({
      data: {
        timestamp,
        validatorIndex: VALIDATOR_1,
        dataBySlot: [[1, 0]],
        dataByEpoch: [[1, '1', '1', '1', '1', '0', '0', '0', '0']],
        attestationCount: 1,
        syncRewardTotal: BigInt(0),
        syncMissedRewardTotal: BigInt(0),
        clRewardTotal: BigInt(4),
        clMissedRewardTotal: BigInt(0),
      },
    });
  }

  /**
   * Helper: run incremental daily archive steps until no more work is available or the cap is hit.
   */
  async function runArchiveSteps(maxSteps: number): Promise<Date[]> {
    const archivedHours: Date[] = [];
    for (let step = 0; step < maxSteps; step++) {
      const archivedHour = await dailyArchiveController.archive();
      if (!archivedHour) {
        break;
      }
      archivedHours.push(archivedHour);
    }
    return archivedHours;
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

    // Execute the 24 incremental hour merges that complete the test day.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);
    expect(archivedHours[0].getTime()).toBe(TEST_DAY_START.getTime());

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
    expect(v1.syncMissedRewardTotal).toBe(BigInt(0));
    expect(v1.clRewardTotal).toBe(BigInt(1560)); // 24 × 65
    expect(v1.clMissedRewardTotal).toBe(BigInt(0));

    // Validator 2: 24 hours × 1 attestation = 24 total
    const v2 = dailyData.find((d) => d.validatorIndex === VALIDATOR_2)!;
    expect(v2).toBeDefined();
    expect(v2.attestationCount).toBe(24);
    expect(v2.syncRewardTotal).toBe(BigInt(4800)); // 24 × 200
    expect(v2.syncMissedRewardTotal).toBe(BigInt(600)); // 24 × 25
    expect(v2.clRewardTotal).toBe(BigInt(4560)); // 24 × 190
    expect(v2.clMissedRewardTotal).toBe(BigInt(264)); // 24 × 11

    // Verify JSON arrays are concatenated and sorted by first element
    const v1Slots = v1.dataBySlot as Array<(number | string)[]>;
    expect(v1Slots).toHaveLength(24);
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0] as number).toBeGreaterThan(v1Slots[i - 1][0] as number);
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
   * DETAIL RETENTION: Removes old JSON detail after a day finishes archiving.
   *
   * The daily archive keeps aggregate columns forever, but detailed slot/epoch JSON
   * should be nulled once it is older than the configured retention window.
   */
  it('should clean old daily JSON detail after the candidate day completes', async () => {
    const oldDailyTimestamp = new Date('2025-12-01T00:00:00.000Z');

    // Create a daily archive row old enough to fall outside the 14-day detail window.
    await createOldDailyArchiveWithDetail(oldDailyTimestamp);

    // Create enough hourly source partitions to complete Dec 16 and retain the latest 24h.
    const allHours = await createHourlyPartitionsForRange(TEST_DAY_START, 49);
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: allHours[48] },
    });

    // Finish every hourly merge for the candidate day.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    // Verify old JSON detail is removed while aggregate columns remain.
    const oldDaily = await prisma.validatorDailyArchive.findUnique({
      where: {
        timestamp_validatorIndex: {
          timestamp: oldDailyTimestamp,
          validatorIndex: VALIDATOR_1,
        },
      },
    });
    expect(oldDaily?.dataBySlot).toBeNull();
    expect(oldDaily?.dataByEpoch).toBeNull();
    expect(oldDaily?.clRewardTotal).toBe(BigInt(4));
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
  it('should archive the oldest hours while preserving the latest 24 hourly partitions', async () => {
    await createHourlyPartitionsForRange(TEST_DAY_START, 48);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-17T23:00:00.000Z') },
    });

    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    expect(dailyPartitions).toHaveLength(1);
  });

  /**
   * IDEMPOTENCY: Calling archive() twice for the same day is a no-op the second time.
   *
   * After the first archive() sets archive.lastDay = Dec 16, the next call computes
   * candidateDayStart = Dec 17. But Dec 17's hourly partitions were retained (not dropped),
   * The next call should move to the next eligible hour instead of repeating
   * any already completed hourly-to-daily merge.
   */
  it('should continue with the next eligible hour after a day completes', async () => {
    await createHourlyPartitionsForRange(TEST_DAY_START, 49);

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: RETENTION_DAY_END }, // Dec 18 00:00
    });

    const firstDayHours = await runArchiveSteps(24);
    expect(firstDayHours).toHaveLength(24);

    const nextHour = await dailyArchiveController.archive();
    expect(nextHour).toStrictEqual(new Date('2025-12-17T00:00:00.000Z'));
  });

  /**
   * JSON CONCATENATION: Multiple elements per hourly array.
   *
   * Each hourly partition has multiple slot tuples and epoch tuples (not just one).
   * The daily archive must concatenate all elements across hours into a single flat
   * array, preserving chronological order.
   *
   * Setup (3 hours with multi-element arrays + 21 filler hours for the full day):
   *   Hour 0: validator has 3 slot tuples and 2 epoch tuples
   *   Hour 1: validator has 2 slot tuples and 1 epoch tuple
   *   Hour 2: validator has 1 slot tuple and 3 epoch tuples
   *   Hours 3–23: 1 slot tuple and 1 epoch tuple each (via createHourlyPartitionsForRange)
   *
   * After archiving:
   *   - data_by_slot has 3+2+1+21 = 27 elements, all in slot-ascending order
   *   - data_by_epoch has 2+1+3+21 = 27 elements, all in epoch-ascending order
   */
  it('should correctly concatenate multi-element JSON arrays across hours', async () => {
    const VALIDATOR_MULTI = 300;

    // Hours 0–2: custom multi-element data
    const hour0 = new Date('2025-12-16T00:00:00.000Z');
    const hour1 = new Date('2025-12-16T01:00:00.000Z');
    const hour2 = new Date('2025-12-16T02:00:00.000Z');

    // Hour 0: 3 slot tuples, 2 epoch tuples
    await createHourlyPartition(hour0, [
      {
        validatorIndex: VALIDATOR_MULTI,
        dataBySlot: [
          [100, 0, '50'],
          [101, 1, '60'],
          [102, 0, '70'],
        ],
        dataByEpoch: [
          [10, '1', '2', '3', '4', '0', '0', '0', '0'],
          [11, '5', '6', '7', '8', '0', '0', '0', '0'],
        ],
        attestationCount: 3,
        syncRewardTotal: BigInt(180),
        clRewardTotal: BigInt(36), // (1+2+3+4)+(5+6+7+8)
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hour 1: 2 slot tuples, 1 epoch tuple
    await createHourlyPartition(hour1, [
      {
        validatorIndex: VALIDATOR_MULTI,
        dataBySlot: [
          [200, 0, '80'],
          [201, 2, '90'],
        ],
        dataByEpoch: [[12, '10', '20', '30', '40', '0', '0', '0', '0']],
        attestationCount: 2,
        syncRewardTotal: BigInt(170),
        clRewardTotal: BigInt(100),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hour 2: 1 slot tuple, 3 epoch tuples
    await createHourlyPartition(hour2, [
      {
        validatorIndex: VALIDATOR_MULTI,
        dataBySlot: [[300, 0, '100']],
        dataByEpoch: [
          [13, '1', '1', '1', '1', '0', '0', '0', '0'],
          [14, '2', '2', '2', '2', '0', '0', '0', '0'],
          [15, '3', '3', '3', '3', '0', '0', '0', '0'],
        ],
        attestationCount: 1,
        syncRewardTotal: BigInt(100),
        clRewardTotal: BigInt(24), // 3×(1+1+1+1) + (2+2+2+2) + ... = 4+8+12
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hours 3–23: filler hours with single-element arrays
    for (let h = 3; h < 24; h++) {
      const hour = new Date(TEST_DAY_START.getTime() + h * 3600 * 1000);
      const slot = 400 + h * 10;
      const epoch = 20 + h;
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_MULTI,
          dataBySlot: [[slot, 0, '10']],
          dataByEpoch: [[epoch, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(10),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    // Retention: 25 hours (Dec 17 00:00–Dec 18 00:00)
    const retentionStart = new Date('2025-12-17T00:00:00.000Z');
    for (let h = 0; h < 25; h++) {
      const hour = new Date(retentionStart.getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_MULTI,
          dataBySlot: [[9000 + h, 0, '1']],
          dataByEpoch: [[900 + h, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(1),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    // Set lastHour to Dec 18 00:00 (satisfies retention rule)
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    // Execute the 24 incremental hour merges that complete the day.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot: 3 + 2 + 1 + 21×1 = 27 elements
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(27);

    // Verify all elements are in ascending slot order
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i][0] as number).toBeGreaterThan(slots[i - 1][0] as number);
    }

    // Verify first elements come from hour 0 (slots 100, 101, 102)
    expect(slots[0][0]).toBe(100);
    expect(slots[1][0]).toBe(101);
    expect(slots[2][0]).toBe(102);

    // Verify hour 1 elements follow (slots 200, 201)
    expect(slots[3][0]).toBe(200);
    expect(slots[4][0]).toBe(201);

    // data_by_epoch: 2 + 1 + 3 + 21×1 = 27 elements
    const epochs = v.dataByEpoch as Array<(number | string)[]>;
    expect(epochs).toHaveLength(27);

    // Verify all elements are in ascending epoch order
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i][0] as number).toBeGreaterThan(epochs[i - 1][0] as number);
    }

    // Verify scalar aggregation is correct
    // attestation_count: 3 + 2 + 1 + 21×1 = 27
    expect(v.attestationCount).toBe(27);
    // sync_reward_total: 180 + 170 + 100 + 21×10 = 660
    expect(v.syncRewardTotal).toBe(BigInt(660));
  });

  /**
   * JSON CONCATENATION: Empty arrays mixed with non-empty arrays.
   *
   * Some hours have empty data_by_slot ([]) while having non-empty data_by_epoch,
   * and vice versa. The string_agg concatenation must handle empty arrays by
   * excluding them (the CASE WHEN jsonb_array_length > 0 guard).
   *
   * Setup (3 custom hours + 21 filler hours):
   *   Hour 0: data_by_slot = [[100, 0]], data_by_epoch = []     (slots only)
   *   Hour 1: data_by_slot = [],         data_by_epoch = [[10, ...]]  (epochs only)
   *   Hour 2: data_by_slot = [],         data_by_epoch = []     (both empty)
   *   Hours 3–23: both non-empty (single element each)
   *
   * After archiving:
   *   - data_by_slot: 1 + 0 + 0 + 21 = 22 elements
   *   - data_by_epoch: 0 + 1 + 0 + 21 = 22 elements
   *   - Neither array should contain invalid JSON from empty-array concatenation
   */
  it('should handle empty JSON arrays mixed with non-empty arrays', async () => {
    const VALIDATOR_EMPTY = 400;

    // Hour 0: slots only, no epoch data
    await createHourlyPartition(new Date('2025-12-16T00:00:00.000Z'), [
      {
        validatorIndex: VALIDATOR_EMPTY,
        dataBySlot: [[100, 0, '50']],
        dataByEpoch: [],
        attestationCount: 1,
        syncRewardTotal: BigInt(50),
        clRewardTotal: BigInt(0),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hour 1: epochs only, no slot data
    await createHourlyPartition(new Date('2025-12-16T01:00:00.000Z'), [
      {
        validatorIndex: VALIDATOR_EMPTY,
        dataBySlot: [],
        dataByEpoch: [[10, '5', '5', '5', '5', '0', '0', '0', '0']],
        attestationCount: 0,
        syncRewardTotal: BigInt(0),
        clRewardTotal: BigInt(20),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hour 2: both empty
    await createHourlyPartition(new Date('2025-12-16T02:00:00.000Z'), [
      {
        validatorIndex: VALIDATOR_EMPTY,
        dataBySlot: [],
        dataByEpoch: [],
        attestationCount: 0,
        syncRewardTotal: BigInt(0),
        clRewardTotal: BigInt(0),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Hours 3–23: both non-empty
    for (let h = 3; h < 24; h++) {
      const hour = new Date(TEST_DAY_START.getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_EMPTY,
          dataBySlot: [[200 + h, 0, '10']],
          dataByEpoch: [[20 + h, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(10),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    // Retention hours
    for (let h = 0; h < 25; h++) {
      const hour = new Date(new Date('2025-12-17T00:00:00.000Z').getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_EMPTY,
          dataBySlot: [[9000 + h, 0, '1']],
          dataByEpoch: [[900 + h, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(1),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot: 1 (hour 0) + 0 + 0 + 21 = 22
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(22);
    // First slot from hour 0
    expect(slots[0][0]).toBe(100);
    // Remaining slots from hours 3–23 (slot numbers 203–223)
    expect(slots[1][0]).toBe(203);

    // data_by_epoch: 0 + 1 (hour 1) + 0 + 21 = 22
    const epochs = v.dataByEpoch as Array<(number | string)[]>;
    expect(epochs).toHaveLength(22);
    // First epoch from hour 1
    expect(epochs[0][0]).toBe(10);
    // Remaining epochs from hours 3–23
    expect(epochs[1][0]).toBe(23);

    // Verify ordering is preserved
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i][0] as number).toBeGreaterThan(slots[i - 1][0] as number);
    }
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i][0] as number).toBeGreaterThan(epochs[i - 1][0] as number);
    }
  });

  /**
   * JSON CONCATENATION: Slot tuples with extended fields (sync, exec, block rewards).
   *
   * Slot tuples can have varying lengths depending on the validator's activity:
   *   - Base:   [slot, delay]                               (attestation only, no sync)
   *   - Sync:   [slot, delay, "sync_reward"]                (has sync committee reward)
   *   - Full:   [slot, delay, "sync", "exec", "block"]     (proposer with all rewards)
   *
   * The string concatenation must preserve the nested structure of these tuples,
   * including the varying number of string-encoded bigint fields. This tests that
   * the substring bracket-stripping doesn't corrupt nested arrays.
   */
  it('should preserve nested tuple structure with varying-length slot tuples', async () => {
    const VALIDATOR_EXTENDED = 500;

    // Hour 0: mixed tuple lengths — base, sync-only, and full proposer tuples
    await createHourlyPartition(new Date('2025-12-16T00:00:00.000Z'), [
      {
        validatorIndex: VALIDATOR_EXTENDED,
        dataBySlot: [
          [100, 0],
          [101, 1, '500'],
          [102, 0, '600', '1000000000000000000', '50000'],
        ],
        dataByEpoch: [[10, '100', '200', '300', '400', '10', '20', '30', '40']],
        attestationCount: 3,
        syncRewardTotal: BigInt(1100),
        execRewardTotal: '1000000000000000000',
        blockRewardTotal: BigInt(50000),
        clRewardTotal: BigInt(1000),
        clMissedRewardTotal: BigInt(100),
      },
    ]);

    // Hour 1: another set of mixed tuples
    await createHourlyPartition(new Date('2025-12-16T01:00:00.000Z'), [
      {
        validatorIndex: VALIDATOR_EXTENDED,
        dataBySlot: [
          [200, 0, '0', '2000000000000000000', '60000'],
          [201, 0],
        ],
        dataByEpoch: [[11, '50', '60', '70', '80', '5', '6', '7', '8']],
        attestationCount: 2,
        syncRewardTotal: BigInt(0),
        execRewardTotal: '2000000000000000000',
        blockRewardTotal: BigInt(60000),
        clRewardTotal: BigInt(260),
        clMissedRewardTotal: BigInt(26),
      },
    ]);

    // Hours 2–23: simple single-element tuples
    for (let h = 2; h < 24; h++) {
      const hour = new Date(TEST_DAY_START.getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_EXTENDED,
          dataBySlot: [[300 + h, 0, '10']],
          dataByEpoch: [[20 + h, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(10),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    // Retention hours
    for (let h = 0; h < 25; h++) {
      const hour = new Date(new Date('2025-12-17T00:00:00.000Z').getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_EXTENDED,
          dataBySlot: [[9000 + h, 0, '1']],
          dataByEpoch: [[900 + h, '1', '1', '1', '1', '0', '0', '0', '0']],
          attestationCount: 1,
          syncRewardTotal: BigInt(1),
          clRewardTotal: BigInt(4),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot: 3 (hour 0) + 2 (hour 1) + 22×1 = 27
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(27);

    // Verify tuple structures are preserved:
    // Hour 0, slot 100: base tuple [slot, delay]
    expect(slots[0]).toEqual([100, 0]);
    // Hour 0, slot 101: sync tuple [slot, delay, "sync"]
    expect(slots[1]).toEqual([101, 1, '500']);
    // Hour 0, slot 102: full tuple [slot, delay, "sync", "exec", "block"]
    expect(slots[2]).toEqual([102, 0, '600', '1000000000000000000', '50000']);
    // Hour 1, slot 200: full tuple
    expect(slots[3]).toEqual([200, 0, '0', '2000000000000000000', '60000']);
    // Hour 1, slot 201: base tuple
    expect(slots[4]).toEqual([201, 0]);

    // Verify exec_reward_total aggregation (large numbers as Decimal/string)
    // 1000000000000000000 + 2000000000000000000 = 3000000000000000000
    expect(v.execRewardTotal?.toString()).toBe('3000000000000000000');

    // Verify block_reward_total: 50000 + 60000 = 110000
    expect(v.blockRewardTotal).toBe(BigInt(110000));

    // Verify ordering across all slots
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i][0] as number).toBeGreaterThan(slots[i - 1][0] as number);
    }
  });

  /**
   * JSON CONCATENATION: All hours have empty arrays for one column.
   *
   * When every hourly record has an empty data_by_epoch ([]), the daily archive
   * should produce an empty array ([]) — not null, not malformed JSON.
   * The COALESCE(..., '[]'::jsonb) fallback handles this when string_agg returns NULL
   * (because all CASE expressions evaluate to NULL for empty arrays).
   */
  it('should produce empty array when all hours have empty JSON arrays', async () => {
    const VALIDATOR_ALL_EMPTY = 600;

    // All 24 hours: data_by_slot has content, data_by_epoch is always empty
    for (let h = 0; h < 24; h++) {
      const hour = new Date(TEST_DAY_START.getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_ALL_EMPTY,
          dataBySlot: [[1000 + h, 0, '10']],
          dataByEpoch: [],
          attestationCount: 1,
          syncRewardTotal: BigInt(10),
          clRewardTotal: BigInt(0),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    // Retention hours
    for (let h = 0; h < 25; h++) {
      const hour = new Date(new Date('2025-12-17T00:00:00.000Z').getTime() + h * 3600 * 1000);
      await createHourlyPartition(hour, [
        {
          validatorIndex: VALIDATOR_ALL_EMPTY,
          dataBySlot: [[9000 + h, 0, '1']],
          dataByEpoch: [],
          attestationCount: 1,
          syncRewardTotal: BigInt(1),
          clRewardTotal: BigInt(0),
          clMissedRewardTotal: BigInt(0),
        },
      ]);
    }

    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot: 24 elements (one per hour)
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(24);

    // data_by_epoch: all hours were empty → should be empty array, not null
    const epochs = v.dataByEpoch as Array<(number | string)[]>;
    expect(epochs).toEqual([]);

    // cl_reward_total should be 0 (not null)
    expect(v.clRewardTotal).toBe(BigInt(0));
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

    const archivedHours = await runArchiveSteps(10);
    expect(archivedHours).toHaveLength(10);
    expect(archivedHours[0].getTime()).toBe(partialDayStart.getTime());

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
