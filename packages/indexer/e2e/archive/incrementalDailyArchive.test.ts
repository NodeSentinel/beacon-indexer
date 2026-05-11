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
  const TEST_DAY_START = new Date('2025-12-16T00:00:00.000Z');
  const FIRST_HOUR = new Date('2025-12-16T00:00:00.000Z');
  const RETENTION_BOUNDARY_HOUR = new Date('2025-12-17T00:00:00.000Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Create the Prisma client used by the e2e database.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    // Create the daily archive controller with the normal storage implementation.
    dailyArchiveStorage = new DailyArchiveStorage(prisma, 14);
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

    // Clean progress rows when the migration is present.
    await prisma.$executeRawUnsafe(`DELETE FROM archive_hour_merge_progress`);

    // Keep validator rows small but include one validator in each hardcoded 5000-sized batch.
    await prisma.validator.deleteMany({
      where: { id: { in: [FIRST_BATCH_VALIDATOR, SECOND_BATCH_VALIDATOR] } },
    });
    await prisma.validator.createMany({
      data: [
        { id: FIRST_BATCH_VALIDATOR, balance: BigInt(0) },
        { id: SECOND_BATCH_VALIDATOR, balance: BigInt(0) },
      ],
    });

    // Reset archive control state so only this test's lastHour drives eligibility.
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: RETENTION_BOUNDARY_HOUR, lastDay: null },
      create: { id: 1, lastHour: RETENTION_BOUNDARY_HOUR, lastDay: null },
    });
  });

  /**
   * Creates one hourly archive partition with two validators.
   * The validator indexes intentionally land in different 5000-validator batches.
   */
  async function createSourceHourlyPartition(): Promise<string> {
    const partitionName = getHourlyArchivePartitionName('validator_hourly_archive', FIRST_HOUR);
    const nextHour = new Date(FIRST_HOUR.getTime() + 3600 * 1000);

    // Create the physical hourly partition that should be merged incrementally.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_hourly_archive" ` +
        `FOR VALUES FROM ('${FIRST_HOUR.toISOString()}') TO ('${nextHour.toISOString()}')`,
    );

    // Insert one row per validator so the first archive call can only merge the first batch.
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
   * Verifies that the controller processes one atomic batch and keeps the source partition.
   */
  it('merges one eligible hourly batch into daily and keeps the source partition until the hour completes', async () => {
    // Create the source partition that has just left the 24-hour hourly query window.
    const sourcePartition = await createSourceHourlyPartition();

    // Run one daily archive step; only validator indexes below 5000 should merge.
    const archived = await dailyArchiveController.archive();
    expect(archived).toStrictEqual(FIRST_HOUR);

    // Verify the first batch is visible in the daily archive.
    const dailyRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(dailyRows.map((row) => row.validatorIndex)).toEqual([FIRST_BATCH_VALIDATOR]);

    // Verify progress advanced to the next batch without marking the hour completed.
    const [progress] = await prisma.$queryRaw<
      Array<{ next_batch_start: number; completed: boolean }>
    >`
      SELECT next_batch_start, completed
      FROM archive_hour_merge_progress
      WHERE hour_start = ${FIRST_HOUR}::timestamp
    `;
    expect(progress).toEqual({ next_batch_start: 5000, completed: false });

    // Verify the source hourly partition remains because one validator batch is still pending.
    const remainingPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${sourcePartition}
    `;
    expect(remainingPartitions).toHaveLength(1);
  });

  /**
   * Verifies that batch sizing stays in code and is not persisted as workflow state.
   */
  it('keeps batch size out of the persisted hourly merge progress row', async () => {
    // Create one source partition so the merge progress table receives a row.
    await createSourceHourlyPartition();

    // Run one archive step so the progress row is created.
    await dailyArchiveController.archive();

    // Verify the progress table does not expose a batch_size column.
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'archive_hour_merge_progress'
      ORDER BY column_name ASC
    `;
    expect(columns.map((column) => column.column_name)).not.toContain('batch_size');
  });

  /**
   * Verifies that the e2e test catches the old persisted batch size contract.
   */
  it('uses the code-level batch size to advance progress', async () => {
    // Create the source partition and process only the first validator batch.
    await createSourceHourlyPartition();
    await dailyArchiveController.archive();

    // Verify progress advanced by the code-level batch size.
    const [progress] = await prisma.$queryRaw<Array<{ next_batch_start: number }>>`
      SELECT next_batch_start
      FROM archive_hour_merge_progress
      WHERE hour_start = ${FIRST_HOUR}::timestamp
    `;
    expect(progress.next_batch_start).toBe(5000);
  });

  /**
   * Verifies that resume completes the pending batch, drops the source, and does not duplicate data.
   */
  it('resumes from progress, completes the hour, and does not advance lastDay for an incomplete day', async () => {
    // Create the source hourly partition and process the first validator batch.
    const sourcePartition = await createSourceHourlyPartition();
    await dailyArchiveController.archive();

    // Run the next archive step so the second validator batch completes the hour.
    const archived = await dailyArchiveController.archive();
    expect(archived).toStrictEqual(FIRST_HOUR);

    // Verify both validators are present exactly once in the daily archive.
    const dailyRows = await prisma.validatorDailyArchive.findMany({
      where: { timestamp: TEST_DAY_START },
      orderBy: { validatorIndex: 'asc' },
    });
    expect(dailyRows.map((row) => row.validatorIndex)).toEqual([
      FIRST_BATCH_VALIDATOR,
      SECOND_BATCH_VALIDATOR,
    ]);
    expect(dailyRows[0].dataBySlot).toEqual([[1, 0, '10']]);
    expect(dailyRows[1].dataBySlot).toEqual([[2, 1, '20']]);

    // Verify progress is completed after the second batch.
    const [progress] = await prisma.$queryRaw<Array<{ completed: boolean; completed_at: Date }>>`
      SELECT completed, completed_at
      FROM archive_hour_merge_progress
      WHERE hour_start = ${FIRST_HOUR}::timestamp
    `;
    expect(progress.completed).toBe(true);
    expect(progress.completed_at).toBeInstanceOf(Date);

    // Verify the completed source hourly partition was dropped.
    const remainingPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename = ${sourcePartition}
    `;
    expect(remainingPartitions).toHaveLength(0);

    // Verify the day boundary does not advance because only one hour of the day is complete.
    const archive = await prisma.archive.findUnique({ where: { id: 1 } });
    expect(archive?.lastDay).toBeNull();
  });

  /**
   * Verifies that old completed progress rows are cleaned after an hour completes.
   */
  it('cleans completed hourly merge progress older than 48 hours without deleting pending rows', async () => {
    // Create progress rows around the 48-hour retention cutoff.
    await prisma.$executeRaw`
      INSERT INTO archive_hour_merge_progress (
        hour_start,
        day_start,
        source_partition,
        next_batch_start,
        max_validator,
        completed,
        completed_at
      )
      VALUES
        (
          ${new Date('2025-12-13T23:00:00.000Z')}::timestamp,
          ${new Date('2025-12-13T00:00:00.000Z')}::timestamp,
          'old_completed_partition',
          5000,
          1,
          true,
          NOW()
        ),
        (
          ${new Date('2025-12-14T00:00:00.000Z')}::timestamp,
          ${new Date('2025-12-14T00:00:00.000Z')}::timestamp,
          'kept_completed_partition',
          5000,
          1,
          true,
          NOW()
        ),
        (
          ${new Date('2025-12-13T22:00:00.000Z')}::timestamp,
          ${new Date('2025-12-13T00:00:00.000Z')}::timestamp,
          'old_pending_partition',
          0,
          1,
          false,
          NULL
        )
    `;

    // Create the source hourly partition and finish both batches.
    await createSourceHourlyPartition();
    await dailyArchiveController.archive();
    await dailyArchiveController.archive();

    // Verify only completed progress older than 48 hours was removed.
    const remaining = await prisma.$queryRaw<Array<{ hour_start: Date }>>`
      SELECT hour_start
      FROM archive_hour_merge_progress
      ORDER BY hour_start ASC
    `;
    expect(remaining.map((row) => row.hour_start.toISOString())).toEqual([
      '2025-12-13T22:00:00.000Z',
      '2025-12-14T00:00:00.000Z',
      FIRST_HOUR.toISOString(),
    ]);
  });

  /**
   * Verifies that the daily archive state machine ignores overlapping epoch events.
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

    // Complete the in-flight archive step and stop the actor.
    resolveArchive(FIRST_HOUR);
    await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
    actor.stop();
  });
});
