import { Prisma, PrismaClient } from '@beacon-indexer/db';
import { beforeAll, beforeEach, describe, expect, it, afterAll } from 'vitest';

import { chainConfig } from '@/src/lib/env.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';

describe('Incident Sync Process', () => {
  let prisma: PrismaClient;
  let incidentStorage: IncidentStorage;

  // Reuse a fixed validator id so the fixtures stay easy to follow.
  const VALIDATOR_INDEX = 101;

  // Keep all fixtures under one cluster so cleanup and assertions stay compact.
  const CLUSTER_ID = 'incident-cluster';

  // Use a stable user id to simplify fixture creation.
  const USER_ID = 'incident-user';

  // Convert a slot to the UTC timestamp used by the indexer.
  function getSlotDate(slot: number): Date {
    return new Date(chainConfig.beacon.genesisTimestamp + slot * chainConfig.beacon.slotDuration);
  }

  // Create the daily archive partition required before inserting a daily row.
  async function ensureDailyPartition(dayStart: Date): Promise<void> {
    const partitionName = `validator_daily_archive_test_${dayStart.toISOString().slice(0, 10).replaceAll('-', '')}`;
    const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Create the matching range partition for the test day.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_daily_archive" ` +
        `FOR VALUES FROM ('${dayStart.toISOString()}') TO ('${nextDay.toISOString()}')`,
    );
  }

  // Create the epoch_rewards partition required before inserting raw epoch rows.
  async function ensureEpochPartition(
    startEpoch: number,
    endEpochExclusive: number,
  ): Promise<void> {
    const partitionName = `epoch_rewards_test_${startEpoch}_${endEpochExclusive}`;

    // Create the matching epoch range partition for the test data.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "epoch_rewards" ` +
        `FOR VALUES FROM (${startEpoch}) TO (${endEpochExclusive})`,
    );
  }

  beforeAll(async () => {
    // E2E tests require a real PostgreSQL database.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Use the same connection style as the other indexer e2e suites.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    // Exercise the real storage class against Postgres.
    incidentStorage = new IncidentStorage(prisma);
  });

  afterAll(async () => {
    // Always disconnect so the test process can exit cleanly.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drop any test-created epoch partitions from prior runs.
    const epochPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'epoch_rewards_test_%'
    `;
    for (const partition of epochPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    // Drop any test-created daily archive partitions from prior runs.
    const dailyPartitions = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE tablename LIKE 'validator_daily_archive_test_%'
    `;
    for (const partition of dailyPartitions) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tablename}"`);
    }

    // Remove data from the non-partitioned tables touched by the incident workflow.
    await prisma.notificationQueue.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
    await prisma.validatorSyncRewards.deleteMany({});
    await prisma.validatorDailyArchive.deleteMany({});
    await prisma.validator.deleteMany({});

    // Reset the archive boundary so each test can define its own source split.
    await prisma.archive.upsert({
      where: { id: 1 },
      update: { lastHour: null, lastDay: null, lastMonth: null },
      create: { id: 1, lastHour: null, lastDay: null, lastMonth: null },
    });

    // Seed the validator referenced by the incident fixtures.
    await prisma.validator.create({
      data: {
        id: VALIDATOR_INDEX,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });

    // Seed the user that owns the cluster and can receive notifications.
    await prisma.user.create({
      data: {
        id: USER_ID,
        username: 'incident-user',
        telegramId: BigInt(123456),
        hasBlockedBot: false,
      },
    });

    // Seed the cluster that will own the incident.
    await prisma.cluster.create({
      data: {
        id: CLUSTER_ID,
        name: 'Incident Cluster',
        ownerId: USER_ID,
      },
    });

    // Link the validator into the cluster under test.
    await prisma.clusterValidator.create({
      data: {
        clusterId: CLUSTER_ID,
        validatorIndex: VALIDATOR_INDEX,
      },
    });
  });

  /**
   * RAW WINDOW: close an incident using only live raw tables.
   *
   * Scenario:
   * - The incident is already open for one validator.
   * - The validator is healthy again in snapshot, so the incident should close.
   * - The opening hour is still unarchived, so rewards must be reconstructed from
   *   raw `epoch_rewards` + `validator_sync_rewards`.
   *
   * Expected result:
   * - `missed_consensus_rewards` stores CL missed + missed sync reward.
   * - The close notification payload no longer contains `missedExecutionRewards`.
   */
  it('should close a raw-window incident with missed consensus rewards and no execution field', async () => {
    // Pick a short incident that stays inside a single epoch for simple assertions.
    const openedSlot = chainConfig.beacon.slotsPerEpoch * 200;

    // Close it a few slots later while staying in the same epoch.
    const closedSlot = openedSlot + 10;

    // Reuse the chain clock conversion used by the indexer.
    const openedAt = getSlotDate(openedSlot);

    // Seed the live snapshot as healthy so the open incident becomes eligible for closure.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: VALIDATOR_INDEX,
        status: 'active',
        isInactive: false,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });

    // Seed the open incident that the sync should close.
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt,
        openedSlot,
        validatorIndexes: [VALIDATOR_INDEX],
      },
    });

    // Create the raw epoch partition that covers the incident epoch.
    await ensureEpochPartition(200, 201);

    // Seed one epoch reward row with 10 units of missed CL reward.
    await prisma.epochRewards.create({
      data: {
        epoch: 200,
        validatorIndex: VALIDATOR_INDEX,
        head: BigInt(0),
        target: BigInt(0),
        source: BigInt(0),
        inactivity: BigInt(0),
        missedHead: BigInt(4),
        missedTarget: BigInt(3),
        missedSource: BigInt(2),
        missedInactivity: BigInt(1),
      },
    });

    // Seed one missed sync reward and one earned sync reward to verify only negatives count.
    await prisma.validatorSyncRewards.createMany({
      data: [
        {
          slot: openedSlot + 5,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-5),
        },
        {
          slot: openedSlot + 6,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(9),
        },
      ],
    });

    // Execute the incident sync at the observed closing slot.
    await incidentStorage.syncIncidents({
      observedAt: getSlotDate(closedSlot),
      observedAtIso: getSlotDate(closedSlot).toISOString(),
      observedSlot: closedSlot,
    });

    // Reload the incident to validate the persisted closure fields.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });

    // The incident should now be closed with 10 CL missed + 5 sync missed = 15.
    expect(incident.status).toBe('closed');
    expect(incident.missedConsensusRewards).toBe(BigInt(15));

    // The close notification should be queued for delivery.
    const notification = await prisma.notificationQueue.findFirstOrThrow({
      where: { type: 'incident_closed' },
    });

    // The payload keeps the consensus field and omits the old execution field entirely.
    const payload = notification.payload as Record<string, unknown>;
    expect(payload.missedConsensusRewards).toBe('15');
    expect(payload).not.toHaveProperty('missedExecutionRewards');
  });

  /**
   * CLEANED DETAIL: close an incident whose archived boundary row no longer has JSON detail.
   *
   * Scenario:
   * - The incident opening hour is already archived.
   * - The corresponding daily archive row exists, but its JSON detail was cleaned to NULL.
   * - The incident therefore cannot be reconstructed precisely anymore.
   *
   * Expected result:
   * - The incident still closes.
   * - `missed_consensus_rewards` stays NULL to avoid reporting an imprecise number.
   */
  it('should leave missed consensus rewards null when archived detail is no longer available', async () => {
    // Pick a slot well in the past so the test can treat it as archived data.
    const openedSlot = chainConfig.beacon.slotsPerEpoch * 400;

    // Close the incident later in the same day to force a partial archived boundary.
    const closedSlot = openedSlot + 12;

    // Convert the opening slot into the incident timestamps used by storage.
    const openedAt = getSlotDate(openedSlot);

    // Derive the archived day partition that will hold the cleaned row.
    const openedDay = new Date(
      Date.UTC(
        openedAt.getUTCFullYear(),
        openedAt.getUTCMonth(),
        openedAt.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    // Seed the snapshot as healthy so the incident is eligible for closure.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: VALIDATOR_INDEX,
        status: 'active',
        isInactive: false,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });

    // Seed the open incident that should close in this sync tick.
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt,
        openedSlot,
        validatorIndexes: [VALIDATOR_INDEX],
      },
    });

    // Create the daily partition that represents the archived day.
    await ensureDailyPartition(openedDay);

    // Insert a cleaned daily row: aggregates exist, but JSON detail was already removed.
    await prisma.validatorDailyArchive.create({
      data: {
        timestamp: openedDay,
        validatorIndex: VALIDATOR_INDEX,
        dataBySlot: Prisma.DbNull,
        dataByEpoch: Prisma.DbNull,
        attestationCount: 1,
        syncRewardTotal: BigInt(0),
        syncMissedRewardTotal: BigInt(25),
        clRewardTotal: BigInt(0),
        clMissedRewardTotal: BigInt(30),
      },
    });

    // Mark the opening hour as archived so the storage attempts the archive path.
    await prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: new Date(openedDay.getTime() + 60 * 60 * 1000) },
    });

    // Execute the sync at the observed closing slot.
    await incidentStorage.syncIncidents({
      observedAt: getSlotDate(closedSlot),
      observedAtIso: getSlotDate(closedSlot).toISOString(),
      observedSlot: closedSlot,
    });

    // Reload the incident to verify that closure happened but the reward stayed unknown.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });

    // The incident closes, but the missed rewards remain NULL because precision is gone.
    expect(incident.status).toBe('closed');
    expect(incident.missedConsensusRewards).toBeNull();
  });
});
