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

  // This day is the first UTC day that can be published by the daily archive.
  const TEST_DAY_START = new Date('2025-12-16T00:00:00.000Z');

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
    await prisma.$executeRawUnsafe(`DELETE FROM archive_daily_merge_progress`);

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
   * Helper: return the detached WIP table name used before a daily partition is published.
   */
  function getDailyWipPartitionName(dayStart: Date): string {
    return `validator_daily_archive_wip_${dayStart.toISOString().slice(0, 10).replaceAll('-', '')}`;
  }

  /**
   * HAPPY PATH: publish a full daily archive from exactly one day of hourly sources.
   *
   * The test uses the 24 source partitions needed to complete Dec 16 and verifies
   * that the published daily partition has the expected sums and JSON ordering.
   */
  it('publishes a completed day from 24 eligible hourly partitions', async () => {
    const allHours = await createHourlyPartitionsForRange(TEST_DAY_START, 24);

    // Make the final Dec 16 source hour old enough to leave the 24-hour window.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-17T23:00:00.000Z') },
    });

    // Merge every hourly source that belongs to Dec 16.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);
    expect(archivedHours[0].getTime()).toBe(TEST_DAY_START.getTime());
    expect(archivedHours[23]).toStrictEqual(new Date('2025-12-16T23:00:00.000Z'));

    // Verify Dec 16 is visible only after all 24 source hours complete.
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });

    expect(dailyData.map((row) => row.validatorIndex)).toEqual([VALIDATOR_1, VALIDATOR_2]);

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

    // Verify every source hourly partition was dropped after it was merged.
    const remainingHourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    const remainingNames = remainingHourlyPartitions.map((p) => p.tablename);
    for (let h = 0; h < 24; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).not.toContain(name);
    }
    expect(remainingNames).toHaveLength(0);

    // Verify the published daily partition exists.
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = 'validator_daily_archive_20251216'
    `;
    expect(dailyPartitions).toHaveLength(1);

    // Verify only the fully completed Dec 16 day advances the control row.
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive!.lastDay!.getTime()).toBe(TEST_DAY_START.getTime());
  });

  /**
   * ROLLING RETENTION: archive the oldest eligible hour after a completed day.
   *
   * Timeline:
   *   Dec 16 00:00         -> already published daily archive (`archive.lastDay`)
   *   Dec 17 00:00         -> oldest source hour, eligible because `lastHour` is Dec 18 00:00
   *   Dec 17 01:00-Dec 18 00:00 -> latest 24 hourly partitions, kept for recent queries
   *
   * Expected result:
   *   - Dec 17 00:00 moves into `validator_daily_archive_wip_20251217`
   *   - Dec 17 stays hidden from the daily parent because only one hour is merged
   *   - Dec 17 01:00-Dec 18 00:00 remain as hourly partitions
   */
  it('starts the next day from the oldest eligible hour and keeps the latest 24 hourly partitions', async () => {
    const nextDayStart = new Date('2025-12-17T00:00:00.000Z');

    // Create Dec 17 00:00 through Dec 18 00:00 so only the oldest hour can move out.
    const allHours = await createHourlyPartitionsForRange(nextDayStart, 25);

    // Mark Dec 16 as published and Dec 18 00:00 as the latest hourly boundary.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastDay: TEST_DAY_START, lastHour: allHours[24] },
    });

    // Merge Dec 17 00:00, the oldest hour outside the latest-24h window.
    const archivedHour = await dailyArchiveController.archive();
    expect(archivedHour).toStrictEqual(nextDayStart);

    // Verify Dec 17 is still hidden because only Dec 17 00:00 has been merged.
    const nextDayData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: nextDayStart },
    });
    expect(nextDayData).toHaveLength(0);

    // Verify Dec 17 00:00 rows are staged in the detached WIP table for Dec 17.
    const wipRows = await prisma.$queryRawUnsafe<
      Array<{ validator_index: number; attestation_count: number }>
    >(
      `SELECT validator_index, attestation_count FROM "${getDailyWipPartitionName(nextDayStart)}" ORDER BY validator_index ASC`,
    );
    expect(wipRows).toEqual([
      { validator_index: VALIDATOR_1, attestation_count: 1 },
      { validator_index: VALIDATOR_2, attestation_count: 1 },
    ]);

    // Verify Dec 17 00:00 was dropped from hourly storage after the merge.
    const remainingHourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    const remainingNames = remainingHourlyPartitions.map((p) => p.tablename);
    const mergedHourName = getHourlyArchivePartitionName('validator_hourly_archive', allHours[0]);
    expect(remainingNames).not.toContain(mergedHourName);

    // Verify Dec 17 01:00 through Dec 18 00:00 remain available for recent queries.
    for (let h = 1; h < 25; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).toContain(name);
    }
    expect(remainingNames).toHaveLength(24);

    // Verify the daily cursor now waits for Dec 17 01:00 without completing Dec 17.
    const [progress] = await prisma.$queryRaw<
      Array<{ current_hour: Date; source_partition: string | null; completed: boolean }>
    >`
      SELECT current_hour, source_partition, completed
      FROM archive_daily_merge_progress
      WHERE target_day = ${nextDayStart}::timestamp
    `;
    expect(progress.current_hour).toStrictEqual(new Date('2025-12-17T01:00:00.000Z'));
    expect(progress.source_partition).toBeNull();
    expect(progress.completed).toBe(false);
  });

  /**
   * GAP GUARD: Stops daily archiving when the next expected hourly partition is missing.
   *
   * The daily archive can process old hours incrementally once they leave the 24h
   * retention window, but it must not skip over a missing source hour. If 02:00 is
   * missing, 03:00 must remain untouched until the gap is filled or investigated.
   */
  it('should stop at a missing hourly partition without archiving later hours', async () => {
    const hour00 = new Date('2025-12-16T00:00:00.000Z');
    const hour01 = new Date('2025-12-16T01:00:00.000Z');
    const hour03 = new Date('2025-12-16T03:00:00.000Z');

    // Create the first two expected hours.
    await createHourlyPartition(hour00, [
      {
        validatorIndex: VALIDATOR_1,
        dataBySlot: [[1, 0, '1']],
        dataByEpoch: [[1, '1', '1', '1', '1', '0', '0', '0', '0']],
        attestationCount: 1,
        syncRewardTotal: BigInt(1),
        clRewardTotal: BigInt(4),
        clMissedRewardTotal: BigInt(0),
      },
    ]);
    await createHourlyPartition(hour01, [
      {
        validatorIndex: VALIDATOR_1,
        dataBySlot: [[2, 0, '1']],
        dataByEpoch: [[2, '1', '1', '1', '1', '0', '0', '0', '0']],
        attestationCount: 1,
        syncRewardTotal: BigInt(1),
        clRewardTotal: BigInt(4),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Create a later hour while intentionally leaving 02:00 missing.
    await createHourlyPartition(hour03, [
      {
        validatorIndex: VALIDATOR_1,
        dataBySlot: [[4, 0, '1']],
        dataByEpoch: [[4, '1', '1', '1', '1', '0', '0', '0', '0']],
        attestationCount: 1,
        syncRewardTotal: BigInt(1),
        clRewardTotal: BigInt(4),
        clMissedRewardTotal: BigInt(0),
      },
    ]);

    // Set lastHour far enough ahead so every source hour would be retention-eligible.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    // Process the contiguous hours and stop at the missing 02:00 partition.
    const archivedHours = await runArchiveSteps(4);
    expect(archivedHours).toEqual([hour00, hour01]);

    // Verify the later 03:00 source partition was not archived or dropped.
    const laterPartition = getHourlyArchivePartitionName('validator_hourly_archive', hour03);
    const remainingLaterPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${laterPartition}
    `;
    expect(remainingLaterPartitions).toHaveLength(1);

    // Verify the detached WIP archive contains only the two contiguous source hours.
    const [wipRow] = await prisma.$queryRawUnsafe<Array<{ attestation_count: number }>>(
      `SELECT attestation_count FROM "validator_daily_archive_wip_20251216" ` +
        `WHERE "timestamp" = '2025-12-16T00:00:00.000Z'::timestamp ` +
        `AND validator_index = ${VALIDATOR_1}`,
    );
    expect(wipRow.attestation_count).toBe(2);

    // Verify the incomplete day remains hidden from parent-table queries.
    const dailyRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START, validatorIndex: VALIDATOR_1 },
    });
    expect(dailyRows).toHaveLength(0);
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
