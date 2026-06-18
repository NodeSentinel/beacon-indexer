import { Prisma, PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { DailyArchiveController } from '@/src/services/consensus/controllers/dailyArchive.js';
import { getHourlyArchivePartitionName } from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import { DailyArchiveStorage } from '@/src/services/consensus/storage/dailyArchive.js';
import { dailyArchiveMachine } from '@/src/xstate/archive/dailyArchive.machine.js';

describe('Incremental Daily Archive Process', () => {
  let prisma: PrismaClient;
  let dailyArchiveStorage: DailyArchiveStorage;
  let dailyArchiveController: DailyArchiveController;

  const FIRST_BATCH_VALIDATOR = 100;
  const SECOND_BATCH_VALIDATOR = 6000;

  // Dec 16 is the daily archive target used by these incremental scenarios.
  const TEST_DAY_START = new Date('2025-12-16T00:00:00.000Z');

  // Dec 16 00:00 is the source hour used by the batch-resume tests.
  const FIRST_HOUR = new Date('2025-12-16T00:00:00.000Z');

  // lastHour Dec 17 00:00 makes only Dec 16 00:00 eligible for daily merging.
  const RETENTION_BOUNDARY_HOUR = new Date('2025-12-17T00:00:00.000Z');

  // lastHour Dec 18 00:00 makes every Dec 16 hour eligible for daily merging.
  const PUBLISH_BOUNDARY_HOUR = new Date('2025-12-18T00:00:00.000Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Create the Prisma client used by the e2e database.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    // Create the daily archive controller with the normal storage implementation.
    dailyArchiveStorage = new DailyArchiveStorage(prisma);
    dailyArchiveController = new DailyArchiveController(
      dailyArchiveStorage,
      TEST_DAY_START.getTime(),
    );
  });

  afterAll(async () => {
    // Close the Prisma connection after all archive e2e tests finish.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop hourly archive partitions so each test owns its source data.
    const hourlyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_hourly_archive_%'
    `;
    for (const p of hourlyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Drop daily archive partitions so each test verifies fresh merge output.
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_%'
    `;
    for (const p of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.tablename}"`);
    }

    // Clean partitioned parent tables after child partitions have been removed.
    await prisma.$executeRawUnsafe(`DELETE FROM validator_hourly_archive`);
    await prisma.$executeRawUnsafe(`DELETE FROM validator_daily_archive`);

    // Clean the persistent daily merge cursor between tests.
    await prisma.$executeRawUnsafe(`DELETE FROM archive_daily_merge_progress`);

    // Use one validator in each hardcoded 5000-sized merge batch.
    await prisma.validator.deleteMany({
      where: { id: { in: [FIRST_BATCH_VALIDATOR, SECOND_BATCH_VALIDATOR] } },
    });
    await prisma.validator.createMany({
      data: [
        { id: FIRST_BATCH_VALIDATOR, balance: BigInt(0) },
        { id: SECOND_BATCH_VALIDATOR, balance: BigInt(0) },
      ],
    });

    // Default to a boundary where only Dec 16 00:00 can leave hourly storage.
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: RETENTION_BOUNDARY_HOUR, lastDay: null },
      create: { id: 1, lastHour: RETENTION_BOUNDARY_HOUR, lastDay: null },
    });
  });

  /**
   * Create the Dec 16 00:00 hourly partition used by batch-resume tests.
   *
   * The partition has two validators: index 100 in the first 5000-sized batch
   * and index 6000 in the second batch. This lets one archive call leave
   * unfinished progress that the next call must resume.
   */
  async function createSourceHourlyPartition(): Promise<string> {
    const partitionName = getHourlyArchivePartitionName('validator_hourly_archive', FIRST_HOUR);
    const nextHour = new Date(FIRST_HOUR.getTime() + 3600 * 1000);

    // Create the physical Dec 16 00:00 hourly partition.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_hourly_archive" ` +
        `FOR VALUES FROM ('${FIRST_HOUR.toISOString()}') TO ('${nextHour.toISOString()}')`,
    );

    // Insert rows in two validator ranges so merge progress spans two calls.
    await prisma.validatorHourlyArchive.createMany({
      data: [
        {
          timestamp: FIRST_HOUR,
          validatorIndex: FIRST_BATCH_VALIDATOR,
          dataBySlot: [[1, 0, '10']],
          dataByEpoch: [[1, '1', '2', '3', '4', '0', '0', '0', '0']],
          attestationCount: 1,
          missedAttestationCount: null,
          syncRewardTotal: BigInt(10),
          syncMissedRewardTotal: BigInt(0),
          execRewardTotal: null,
          blockRewardTotal: null,
          clRewardTotal: BigInt(10),
          clMissedRewardTotal: BigInt(0),
          avgAttestationDelay: 0,
          attestationEfficiency: 1,
        },
        {
          timestamp: FIRST_HOUR,
          validatorIndex: SECOND_BATCH_VALIDATOR,
          dataBySlot: [[2, 1, '20']],
          dataByEpoch: [[1, '5', '6', '7', '8', '1', '1', '1', '1']],
          attestationCount: 1,
          missedAttestationCount: 1,
          syncRewardTotal: BigInt(20),
          syncMissedRewardTotal: BigInt(2),
          execRewardTotal: new Prisma.Decimal(30),
          blockRewardTotal: BigInt(40),
          clRewardTotal: BigInt(26),
          clMissedRewardTotal: BigInt(4),
          avgAttestationDelay: 1,
          attestationEfficiency: 0.75,
        },
      ],
    });

    return partitionName;
  }

  /**
   * Create one hourly partition that completes in a single merge call.
   *
   * The full-day publish test uses this for each Dec 16 hour so each call can
   * advance from one hour to the next without batch-resume behavior.
   */
  async function createSingleBatchHourlyPartition(hourStart: Date, slot: number): Promise<string> {
    const partitionName = getHourlyArchivePartitionName('validator_hourly_archive', hourStart);
    const nextHour = new Date(hourStart.getTime() + 3600 * 1000);

    // Create the source hourly partition for this exact hour.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_hourly_archive" ` +
        `FOR VALUES FROM ('${hourStart.toISOString()}') TO ('${nextHour.toISOString()}')`,
    );

    // Insert one low validator index so one archive call completes this hour.
    await prisma.validatorHourlyArchive.create({
      data: {
        timestamp: hourStart,
        validatorIndex: FIRST_BATCH_VALIDATOR,
        dataBySlot: [[slot, 0, '10']],
        dataByEpoch: [[slot, '1', '2', '3', '4', '0', '0', '0', '0']],
        attestationCount: 1,
        missedAttestationCount: null,
        syncRewardTotal: BigInt(10),
        syncMissedRewardTotal: BigInt(0),
        execRewardTotal: null,
        blockRewardTotal: null,
        clRewardTotal: BigInt(10),
        clMissedRewardTotal: BigInt(0),
        avgAttestationDelay: 0,
        attestationEfficiency: 1,
      },
    });

    return partitionName;
  }

  /**
   * Returns the daily WIP table name used while a day is still incomplete.
   */
  function getDailyWipPartitionName(dayStart: Date): string {
    return `validator_daily_archive_wip_${dayStart.toISOString().slice(0, 10).replaceAll('-', '')}`;
  }

  /**
   * Counts rows in a physical archive table without reading through the partition parent.
   */
  async function countRowsInTable(tableName: string): Promise<number> {
    const [result] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "${tableName}"`,
    );
    return result.count;
  }

  /**
   * Read the PostgreSQL catalog id for one constraint on one physical table.
   */
  async function getConstraintOid(tableName: string, constraintName: string): Promise<number> {
    const [constraint] = await prisma.$queryRaw<Array<{ oid: number }>>`
      SELECT c.oid::int AS oid
      FROM pg_constraint c
      JOIN pg_class table_class ON table_class.oid = c.conrelid
      WHERE table_class.relname = ${tableName}
        AND c.conname = ${constraintName}
    `;
    return constraint.oid;
  }

  /**
   * Verify that one archive call merges only the first validator batch.
   *
   * Timeline:
   *   Dec 16 00:00 -> source hourly partition with validators 100 and 6000
   *   Dec 17 00:00 -> archive.lastHour, so only Dec 16 00:00 is eligible
   *
   * Expected result:
   *   - validator 100 is staged in Dec 16 WIP
   *   - validator 6000 is still pending for the next batch
   *   - Dec 16 00:00 hourly partition remains because the hour is incomplete
   */
  it('merges one eligible hourly batch into daily and keeps the source partition until the hour completes', async () => {
    // Create Dec 16 00:00 with one validator in each 5000-sized batch.
    const sourcePartition = await createSourceHourlyPartition();

    // Run one daily archive step; only validator indexes below 5000 merge.
    const archived = await dailyArchiveController.archive();
    expect(archived).toStrictEqual(FIRST_HOUR);

    // Verify only validator 100 is staged in the detached Dec 16 WIP table.
    const wipRows = await prisma.$queryRawUnsafe<Array<{ validator_index: number }>>(
      `SELECT validator_index FROM "${getDailyWipPartitionName(TEST_DAY_START)}" ORDER BY validator_index ASC`,
    );
    expect(wipRows.map((row) => row.validator_index)).toEqual([FIRST_BATCH_VALIDATOR]);

    // Verify Dec 16 is hidden from parent-table reads while the hour is incomplete.
    const dailyRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(dailyRows).toHaveLength(0);

    // Verify the cursor points to the second validator batch for Dec 16 00:00.
    const [progress] = await prisma.$queryRaw<
      Array<{ next_batch_start: number; completed: boolean }>
    >`
      SELECT next_batch_start, completed
      FROM archive_daily_merge_progress
      WHERE target_day = ${TEST_DAY_START}::timestamp
    `;
    expect(progress).toEqual({ next_batch_start: 5000, completed: false });

    // Verify Dec 16 00:00 remains because validator 6000 has not merged yet.
    const remainingPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${sourcePartition}
    `;
    expect(remainingPartitions).toHaveLength(1);
  });

  /**
   * Verify that a second archive call resumes and completes the same source hour.
   *
   * Timeline:
   *   Call 1 -> merges validator 100 from Dec 16 00:00 and records progress
   *   Call 2 -> resumes Dec 16 00:00 and merges validator 6000
   *
   * Expected result:
   *   - both validators exist once in Dec 16 WIP
   *   - Dec 16 00:00 hourly partition is dropped after the hour completes
   *   - progress advances to Dec 16 01:00, but Dec 16 is not published yet
   */
  it('resumes from progress, completes the hour, and does not advance lastDay for an incomplete day', async () => {
    // Create Dec 16 00:00 and process validator 100 in the first call.
    const sourcePartition = await createSourceHourlyPartition();
    await dailyArchiveController.archive();

    // Run the second call so validator 6000 completes Dec 16 00:00.
    const archived = await dailyArchiveController.archive();
    expect(archived).toStrictEqual(FIRST_HOUR);

    // Verify both validator rows are present exactly once in Dec 16 WIP.
    const wipRows = await prisma.$queryRawUnsafe<
      Array<{ validator_index: number; data_by_slot: unknown }>
    >(
      `SELECT validator_index, data_by_slot FROM "${getDailyWipPartitionName(TEST_DAY_START)}" ORDER BY validator_index ASC`,
    );
    expect(wipRows.map((row) => row.validator_index)).toEqual([
      FIRST_BATCH_VALIDATOR,
      SECOND_BATCH_VALIDATOR,
    ]);
    expect(wipRows[0].data_by_slot).toEqual([[1, 0, '10']]);
    expect(wipRows[1].data_by_slot).toEqual([[2, 1, '20']]);

    // Verify Dec 16 is still hidden because only one hour of the day is complete.
    const dailyRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(dailyRows).toHaveLength(0);

    // Verify the daily cursor now waits for Dec 16 01:00.
    const [progress] = await prisma.$queryRaw<
      Array<{ current_hour: Date; source_partition: string | null; completed: boolean }>
    >`
      SELECT current_hour, source_partition, completed
      FROM archive_daily_merge_progress
      WHERE target_day = ${TEST_DAY_START}::timestamp
    `;
    expect(progress.current_hour).toStrictEqual(new Date('2025-12-16T01:00:00.000Z'));
    expect(progress.source_partition).toBeNull();
    expect(progress.completed).toBe(false);

    // Verify Dec 16 00:00 was dropped after both validator batches completed.
    const remainingPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${sourcePartition}
    `;
    expect(remainingPartitions).toHaveLength(0);

    // Verify lastDay stays null because Dec 16 still needs 23 more hours.
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive?.lastDay).toBeNull();
  });

  /**
   * Verify that resumed validator batches reuse the same WIP day constraint.
   *
   * Timeline:
   *   Call 1 -> creates Dec 16 WIP and its timestamp range CHECK constraint
   *   Call 2 -> resumes Dec 16 00:00 for the next validator batch
   *
   * Expected result:
   *   - the second batch keeps the existing CHECK constraint
   *   - PostgreSQL does not need to revalidate the growing WIP table
   */
  it('keeps the WIP timestamp constraint when a later validator batch resumes', async () => {
    // Create Dec 16 00:00 and process validator 100 in the first call.
    await createSourceHourlyPartition();
    await dailyArchiveController.archive();

    // Capture the original catalog id for the WIP timestamp range constraint.
    const wipName = getDailyWipPartitionName(TEST_DAY_START);
    const constraintName = `${wipName}_timestamp_check`;
    const initialConstraintOid = await getConstraintOid(wipName, constraintName);

    // Resume Dec 16 00:00 and process validator 6000 in the second call.
    await expect(dailyArchiveController.archive()).resolves.toStrictEqual(FIRST_HOUR);

    // Verify the same constraint survived the resumed batch.
    await expect(getConstraintOid(wipName, constraintName)).resolves.toBe(initialConstraintOid);
  });

  /**
   * Verify that Dec 16 is published only after all 24 expected hours complete.
   *
   * Timeline:
   *   Dec 16 00:00-Dec 16 23:00 -> source hours that should be merged
   *   Dec 18 00:00              -> archive.lastHour, so all Dec 16 hours are eligible
   *
   * Expected result:
   *   - after 23 hours, Dec 16 data exists only in detached WIP
   *   - after Dec 16 23:00 completes, WIP is published as daily partition
   *   - archive.lastDay advances to Dec 16 00:00
   */
  it('publishes the WIP daily archive only after every expected hour completes', async () => {
    // Create Dec 16 00:00 through Dec 16 23:00 with one validator per hour.
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = new Date(TEST_DAY_START.getTime() + hour * 3600 * 1000);
      await createSingleBatchHourlyPartition(hourStart, hour + 1);
    }

    // Make every Dec 16 source hour eligible for daily archiving.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: PUBLISH_BOUNDARY_HOUR },
    });

    // Merge Dec 16 00:00 through 22:00; Dec 16 must remain unpublished.
    for (let hour = 0; hour < 23; hour++) {
      await expect(dailyArchiveController.archive()).resolves.toStrictEqual(
        new Date(TEST_DAY_START.getTime() + hour * 3600 * 1000),
      );
    }

    // Verify the detached Dec 16 WIP table exists before the final hour.
    const wipName = getDailyWipPartitionName(TEST_DAY_START);
    await expect(countRowsInTable(wipName)).resolves.toBe(1);

    // Verify parent-table reads cannot see Dec 16 before WIP is published.
    await expect(
      prisma.validatorDailyArchive.findMany({ where: { timestamp: TEST_DAY_START } }),
    ).resolves.toHaveLength(0);

    // Merge Dec 16 23:00; this completes the day and publishes WIP.
    await expect(dailyArchiveController.archive()).resolves.toStrictEqual(
      new Date('2025-12-16T23:00:00.000Z'),
    );

    // Verify the detached WIP table was renamed into a published partition.
    const wipTables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${wipName}
    `;
    expect(wipTables).toHaveLength(0);

    // Verify the published Dec 16 daily partition now exists.
    const publishedTables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = 'validator_daily_archive_20251216'
    `;
    expect(publishedTables).toHaveLength(1);

    // Verify parent-table reads work only after Dec 16 is published.
    const publishedRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
    });
    expect(publishedRows).toHaveLength(1);
    expect(publishedRows[0].attestationCount).toBe(24);

    // Verify the completed day advances the archive control row.
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive?.lastDay).toStrictEqual(TEST_DAY_START);
  });

  /**
   * Verify that overlapping epoch events do not start concurrent daily archives.
   *
   * The archive actor should ignore a second EPOCH_PROCESSED event while the
   * first archive promise is still running. This protects the storage layer from
   * duplicate merge loops started by the same process.
   */
  it('ignores EPOCH_PROCESSED events while an incremental daily merge is already running', async () => {
    let resolveArchive!: (value: Date | null) => void;

    // Create a controller stub whose archive call stays pending until the test releases it.
    const controller = {
      archive: vi.fn(
        () =>
          new Promise<Date | null>((resolve) => {
            resolveArchive = resolve;
          }),
      ),
    } as unknown as DailyArchiveController;

    // Start the daily archive actor with the delayed controller.
    const actor = createActor(dailyArchiveMachine, {
      input: { dailyArchiveController: controller },
    });
    actor.start();

    // Send two events while the first archive promise is still unresolved.
    actor.send({ type: 'EPOCH_PROCESSED', epoch: 1 });
    actor.send({ type: 'EPOCH_PROCESSED', epoch: 2 });

    // Wait one microtask so XState can enter the invoking state.
    await Promise.resolve();
    expect(controller.archive).toHaveBeenCalledTimes(1);

    // Complete the in-flight archive step with no remaining work and stop the actor.
    resolveArchive(null);
    await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
    actor.stop();
  });

  /**
   * Verify that one epoch event drains all available daily archive work.
   *
   * The state machine should call archive again after each successful step and
   * stop only when the controller returns null.
   */
  it('keeps archiving after a successful daily merge step until the controller returns null', async () => {
    // Create a controller stub that reports two completed steps and then no remaining work.
    const controller = {
      archive: vi
        .fn()
        .mockResolvedValueOnce(FIRST_HOUR)
        .mockResolvedValueOnce(new Date('2025-12-16T01:00:00.000Z'))
        .mockResolvedValueOnce(null),
    } as unknown as DailyArchiveController;

    // Start the daily archive actor with the draining controller.
    const actor = createActor(dailyArchiveMachine, {
      input: { dailyArchiveController: controller },
    });
    actor.start();

    // Send one event and expect the state machine to continue invoking archive.
    actor.send({ type: 'EPOCH_PROCESSED', epoch: 1 });

    // Wait until the machine drains all available archive work and returns to idle.
    await vi.waitFor(() => expect(controller.archive).toHaveBeenCalledTimes(3));
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });
});
