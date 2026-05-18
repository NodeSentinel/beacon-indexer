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

  // Test day used by most scenarios: Dec 16 is the daily archive target.
  const TEST_DAY_START = new Date('2025-12-16T00:00:00.000Z');

  /**
   * Recreate the controller with the requested lookback timestamp.
   *
   * Most tests start from Dec 16 00:00. The partial-day test overrides this so
   * the controller knows that missing earlier hours are expected.
   */
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
    // Drop hourly archive partitions left by previous tests.
    const hourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    for (const p of hourlyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Drop published daily partitions and detached WIP daily partitions.
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const p of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Clean parent tables and the persistent daily merge cursor.
    await prisma.$executeRawUnsafe(`DELETE FROM validator_hourly_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM archive_daily_merge_progress`);

    // Reset the archive control row so each test sets its own lastHour and lastDay.
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: null, lastDay: null },
      create: { id: 1, lastHour: null, lastDay: null },
    });

    // Use Dec 16 00:00 as the default first archiveable daily boundary.
    createController();
  });

  /**
   * Create one physical hourly partition and insert the rows that belong to it.
   *
   * Daily archive code works against partitioned hourly tables, so tests must
   * create the child partition before inserting rows through Prisma.
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
   * Create consecutive hourly partitions with two validators per hour.
   *
   * Each hour gets one row for VALIDATOR_1 and one row for VALIDATOR_2. The
   * helper returns the exact timestamps so tests can assert which partitions are
   * dropped or retained.
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
   * HAPPY PATH: publish Dec 16 from exactly 24 hourly source partitions.
   *
   * Timeline:
   *   Dec 16 00:00-Dec 16 23:00 -> source hours that should be merged
   *   Dec 17 23:00              -> archive.lastHour, so Dec 16 23:00 is eligible
   *
   * Expected result:
   *   - 24 archive calls merge every Dec 16 source hour
   *   - `validator_daily_archive_20251216` is published through the daily parent
   *   - each validator has one daily row with 24 hours of aggregated values
   *   - all Dec 16 hourly partitions are dropped after they are merged
   */
  it('publishes a completed day from 24 eligible hourly partitions', async () => {
    // Create only Dec 16 00:00 through Dec 16 23:00 for this publish scenario.
    const allHours = await createHourlyPartitionsForRange(TEST_DAY_START, 24);

    // Set lastHour so the retention cutoff is Dec 16 23:00.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-17T23:00:00.000Z') },
    });

    // Run one archive call per Dec 16 hour; the last call publishes the day.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);
    expect(archivedHours[0].getTime()).toBe(TEST_DAY_START.getTime());
    expect(archivedHours[23]).toStrictEqual(new Date('2025-12-16T23:00:00.000Z'));

    // Read through the daily parent; rows are visible only after WIP is published.
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

    // Verify data_by_slot is the 24 hourly arrays concatenated in slot order.
    const v1Slots = v1.dataBySlot as Array<(number | string)[]>;
    expect(v1Slots).toHaveLength(24);
    for (let i = 1; i < v1Slots.length; i++) {
      expect(v1Slots[i][0] as number).toBeGreaterThan(v1Slots[i - 1][0] as number);
    }

    // Verify data_by_epoch is the 24 hourly arrays concatenated in epoch order.
    const v1Epochs = v1.dataByEpoch as Array<
      [number, string, string, string, string, string, string, string, string]
    >;
    expect(v1Epochs).toHaveLength(24);
    for (let i = 1; i < v1Epochs.length; i++) {
      expect(v1Epochs[i][0]).toBeGreaterThan(v1Epochs[i - 1][0]);
    }

    // Verify every Dec 16 hourly partition was dropped after it was merged.
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

    // Verify the control row advances only after Dec 16 is fully published.
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
   * Timeline:
   *   Dec 16 00:00 -> exists and should be merged
   *   Dec 16 01:00 -> exists and should be merged
   *   Dec 16 02:00 -> missing, so archiving must stop here
   *   Dec 16 03:00 -> exists, but must not be archived while 02:00 is missing
   *
   * Expected result:
   *   - Dec 16 00:00 and 01:00 are staged in WIP
   *   - Dec 16 03:00 remains untouched in hourly storage
   *   - Dec 16 remains hidden from the daily parent because the day is incomplete
   */
  it('should stop at a missing hourly partition without archiving later hours', async () => {
    const hour00 = new Date('2025-12-16T00:00:00.000Z');
    const hour01 = new Date('2025-12-16T01:00:00.000Z');
    const hour03 = new Date('2025-12-16T03:00:00.000Z');

    // Create the first two expected source hours for Dec 16.
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

    // Create Dec 16 03:00 while intentionally leaving Dec 16 02:00 missing.
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

    // Set lastHour far enough ahead so the missing hour is the only blocker.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    // Process Dec 16 00:00 and 01:00, then stop when Dec 16 02:00 is missing.
    const archivedHours = await runArchiveSteps(4);
    expect(archivedHours).toEqual([hour00, hour01]);

    // Verify Dec 16 03:00 was not archived or dropped after the gap.
    const laterPartition = getHourlyArchivePartitionName('validator_hourly_archive', hour03);
    const remainingLaterPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${laterPartition}
    `;
    expect(remainingLaterPartitions).toHaveLength(1);

    // Verify WIP contains only Dec 16 00:00 and 01:00 for this validator.
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
   * This scenario verifies daily JSON aggregation for one validator on Dec 16.
   * Some hourly rows have empty data_by_slot or data_by_epoch arrays, and those
   * empty arrays must not corrupt the concatenated daily JSON.
   *
   * Timeline:
   *   Dec 16 00:00 -> slot data only
   *   Dec 16 01:00 -> epoch data only
   *   Dec 16 02:00 -> both arrays empty
   *   Dec 16 03:00-Dec 16 23:00 -> one slot tuple and one epoch tuple per hour
   *   Dec 17 00:00-Dec 18 00:00 -> recent hourly partitions, not archived here
   *
   * Expected result:
   *   - Dec 16 publishes one daily row for VALIDATOR_EMPTY
   *   - data_by_slot has 22 elements: 1 + 0 + 0 + 21
   *   - data_by_epoch has 22 elements: 0 + 1 + 0 + 21
   */
  it('should handle empty JSON arrays mixed with non-empty arrays', async () => {
    const VALIDATOR_EMPTY = 400;

    // Dec 16 00:00 has slot detail but no epoch detail.
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

    // Dec 16 01:00 has epoch detail but no slot detail.
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

    // Dec 16 02:00 has no JSON detail in either column.
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

    // Dec 16 03:00 through 23:00 have normal one-element JSON arrays.
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

    // Create Dec 17 00:00 through Dec 18 00:00 as the recent hourly window.
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

    // Make all Dec 16 hours eligible while leaving the recent window untouched.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    // Merge exactly the 24 Dec 16 hours and publish the daily row.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    // Read the published Dec 16 daily row for the custom validator.
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot keeps hour 0 and hours 3 through 23.
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(22);
    // First slot comes from Dec 16 00:00.
    expect(slots[0][0]).toBe(100);
    // Next slot comes from Dec 16 03:00 because hours 1 and 2 had no slot detail.
    expect(slots[1][0]).toBe(203);

    // data_by_epoch keeps hour 1 and hours 3 through 23.
    const epochs = v.dataByEpoch as Array<(number | string)[]>;
    expect(epochs).toHaveLength(22);
    // First epoch comes from Dec 16 01:00.
    expect(epochs[0][0]).toBe(10);
    // Next epoch comes from Dec 16 03:00 because hours 0 and 2 had no epoch detail.
    expect(epochs[1][0]).toBe(23);

    // Verify the daily JSON arrays stay ordered after empty arrays are skipped.
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
   * This scenario verifies that daily JSON aggregation preserves nested tuple
   * shapes when different hourly rows use different slot tuple lengths.
   *
   * Timeline:
   *   Dec 16 00:00 -> base, sync-only, and full proposer slot tuples
   *   Dec 16 01:00 -> full proposer tuple and base tuple
   *   Dec 16 02:00-Dec 16 23:00 -> simple one-element slot arrays
   *   Dec 17 00:00-Dec 18 00:00 -> recent hourly partitions, not archived here
   *
   * Expected result:
   *   - Dec 16 publishes one daily row for VALIDATOR_EXTENDED
   *   - the first five slot tuples keep their original nested array shapes
   *   - exec and block rewards are summed without losing precision
   */
  it('should preserve nested tuple structure with varying-length slot tuples', async () => {
    const VALIDATOR_EXTENDED = 500;

    // Dec 16 00:00 mixes base, sync-only, and full proposer tuples.
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

    // Dec 16 01:00 adds another full proposer tuple and a base tuple.
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

    // Dec 16 02:00 through 23:00 add simple one-element slot arrays.
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

    // Create Dec 17 00:00 through Dec 18 00:00 as the recent hourly window.
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

    // Make all Dec 16 hours eligible while leaving the recent window untouched.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date('2025-12-18T00:00:00.000Z') },
    });

    // Merge exactly the 24 Dec 16 hours and publish the daily row.
    const archivedHours = await runArchiveSteps(24);
    expect(archivedHours).toHaveLength(24);

    // Read the published Dec 16 daily row for the custom validator.
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyData).toHaveLength(1);

    const v = dailyData[0];

    // data_by_slot keeps 3 tuples from 00:00, 2 from 01:00, and 22 later tuples.
    const slots = v.dataBySlot as Array<(number | string)[]>;
    expect(slots).toHaveLength(27);

    // Dec 16 00:00, slot 100: base tuple [slot, delay].
    expect(slots[0]).toEqual([100, 0]);
    // Dec 16 00:00, slot 101: sync tuple [slot, delay, "sync"].
    expect(slots[1]).toEqual([101, 1, '500']);
    // Dec 16 00:00, slot 102: full tuple [slot, delay, "sync", "exec", "block"].
    expect(slots[2]).toEqual([102, 0, '600', '1000000000000000000', '50000']);
    // Dec 16 01:00, slot 200: full tuple.
    expect(slots[3]).toEqual([200, 0, '0', '2000000000000000000', '60000']);
    // Dec 16 01:00, slot 201: base tuple.
    expect(slots[4]).toEqual([201, 0]);

    // Verify large exec rewards are summed through Decimal without precision loss.
    expect(v.execRewardTotal?.toString()).toBe('3000000000000000000');

    // Verify block rewards from the two proposer tuples are summed.
    expect(v.blockRewardTotal).toBe(BigInt(110000));

    // Verify all concatenated slot tuples remain in ascending slot order.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i][0] as number).toBeGreaterThan(slots[i - 1][0] as number);
    }
  });

  /**
   * LOOKBACK_SLOT BASE CASE: The lookback_slot day can be partial.
   *
   * This scenario covers a new indexer whose first available hourly data starts
   * at Dec 16 14:00 instead of midnight. Missing Dec 16 00:00-13:00 hours are
   * allowed only because Dec 16 is the lookback day.
   *
   * Timeline:
   *   Dec 16 14:00-Dec 16 23:00 -> partial first day, should be merged
   *   Dec 17 00:00-Dec 17 23:00 -> recent hourly partitions, kept
   *   Dec 18 00:00              -> latest hourly boundary
   *
   * Expected result:
   *   - Dec 16 publishes a daily row with 10 hours of data
   *   - Dec 16 14:00-Dec 16 23:00 hourly partitions are dropped
   *   - Dec 17 00:00-Dec 18 00:00 hourly partitions remain
   */
  it('should archive a partial first day when lookback_slot starts mid-day', async () => {
    const partialDayStart = new Date('2025-12-16T14:00:00.000Z');

    // Start the controller at Dec 16 14:00 so earlier Dec 16 hours are optional.
    createController(partialDayStart.getTime());

    // Create Dec 16 14:00 through Dec 18 00:00.
    const allHours = await createHourlyPartitionsForRange(partialDayStart, 35);

    // Make the partial Dec 16 range eligible while keeping Dec 17-Dec 18 recent.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: allHours[34] },
    });

    // Merge only the 10 available Dec 16 hours.
    const archivedHours = await runArchiveSteps(10);
    expect(archivedHours).toHaveLength(10);
    expect(archivedHours[0].getTime()).toBe(partialDayStart.getTime());

    // Verify the Dec 16 daily row reflects the 10 available hours.
    const dailyData = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(dailyData).toHaveLength(2);

    const v1 = dailyData.find((d) => d.validatorIndex === VALIDATOR_1)!;
    expect(v1.attestationCount).toBe(10); // 10 hours x 1

    // Verify Dec 16 14:00 through 23:00 were dropped after merging.
    const remainingHourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    const remainingNames = remainingHourlyPartitions.map((p) => p.tablename);

    for (let h = 0; h < 10; h++) {
      const name = getHourlyArchivePartitionName('validator_hourly_archive', allHours[h]);
      expect(remainingNames).not.toContain(name);
    }

    // Verify Dec 17 00:00 through Dec 18 00:00 remain as hourly partitions.
    expect(remainingNames).toHaveLength(25);
  });
});
