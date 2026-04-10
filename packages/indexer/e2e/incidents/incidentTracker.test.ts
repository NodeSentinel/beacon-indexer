import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';

// This suite now verifies only the residual incident-table contracts after replay ownership moved away.
describe('Incident Tracker', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let incidentStorage: IncidentStorage;

  const VALIDATOR_INDEX = 101;
  const CLUSTER_ID = 'cluster-a';
  const USER_ID = 'incident-user';

  beforeAll(async () => {
    // E2E tests require a real PostgreSQL database.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Rebuild the clock helper and storage facade for each scenario.
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 0,
      delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
    });

    incidentStorage = new IncidentStorage(prisma, {
      genesisTimeSec: Math.floor(gnosisConfig.beacon.genesisTimestamp / 1000),
      secPerSlot: Math.floor(gnosisConfig.beacon.slotDuration / 1000),
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
    });

    // Clear only the tables this suite touches.
    await prisma.notificationQueue.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
    await prisma.slot.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.validator.deleteMany({});

    // Seed the minimal owner, cluster, and validator records needed for incident rows.
    await prisma.user.create({
      data: {
        id: USER_ID,
        username: 'incident-user',
        telegramId: BigInt(123456),
        hasBlockedBot: false,
      },
    });

    await prisma.cluster.create({
      data: {
        id: CLUSTER_ID,
        name: 'Incident Cluster',
        ownerId: USER_ID,
      },
    });

    await prisma.validator.create({
      data: {
        id: VALIDATOR_INDEX,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });

    await prisma.clusterValidator.create({
      data: {
        clusterId: CLUSTER_ID,
        validatorIndex: VALIDATOR_INDEX,
      },
    });
  });

  // This helper seeds an already-open incident for the shared cluster.
  async function seedOpenIncidentForCluster(
    clusterId: string,
    validatorIndexes: number[],
    openedSlot: number,
  ) {
    await prisma.$transaction(async (tx) => {
      await incidentStorage.openIncidentIfMissing(tx, {
        clusterId,
        openedSlot,
        validatorIndexes,
      });
    });
  }

  // This helper creates or updates the snapshot state the reconciler now reads directly.
  async function seedSnapshotState(
    validatorIndex: number,
    params: {
      isInactive: boolean;
      inactiveSinceSlot: number | null;
    },
  ) {
    await prisma.validatorsSnapshotStats.upsert({
      where: { validatorIndex },
      update: {
        isInactive: params.isInactive,
        inactiveSinceSlot: params.inactiveSinceSlot,
        activeSinceSlot: params.isInactive ? null : 90,
        consecutiveMissedAttestations: params.isInactive ? 4 : 0,
        missedStreakStartedAtSlot: params.inactiveSinceSlot,
      },
      create: {
        validatorIndex,
        status: 'active',
        isInactive: params.isInactive,
        inactiveSinceSlot: params.inactiveSinceSlot,
        activeSinceSlot: params.isInactive ? null : 90,
        consecutiveMissedAttestations: params.isInactive ? 4 : 0,
        missedStreakStartedAtSlot: params.inactiveSinceSlot,
        missedRewardsProcessedThroughSlot: null,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });
  }

  // This scenario locks the database invariant that each cluster can have only one open incident.
  it('allows at most one open incident per cluster', async () => {
    // Seed the first open incident for the shared cluster.
    await seedOpenIncidentForCluster(CLUSTER_ID, [VALIDATOR_INDEX], 120);

    // Try to create a second open incident directly through Prisma.
    await expect(
      prisma.clusterIncident.create({
        data: {
          clusterId: CLUSTER_ID,
          status: 'open',
          openedAt: new Date(beaconTime.getTimestampFromSlotNumber(130)),
          openedSlot: 130,
          validatorIndexes: [102],
        },
      }),
    ).rejects.toThrow();
  });

  // This scenario proves the set-based reconciler opens one incident at the first inactive slot
  // even when additional validators join the same incident in later batches of the same sync run.
  it('opens one incident at the earliest addition slot and keeps the final validator set', async () => {
    // Seed a second validator and attach it to the same cluster so later batches can widen the incident.
    await prisma.validator.create({
      data: {
        id: 102,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });
    await prisma.clusterValidator.create({
      data: {
        clusterId: CLUSTER_ID,
        validatorIndex: 102,
      },
    });

    // Mark both validators inactive with different first-miss slots.
    await seedSnapshotState(VALIDATOR_INDEX, {
      isInactive: true,
      inactiveSinceSlot: 120,
    });
    await seedSnapshotState(102, {
      isInactive: true,
      inactiveSinceSlot: 121,
    });

    // Reconcile from the current snapshot state after processing slot 121.
    await prisma.$transaction(async (tx) => {
      await incidentStorage.reconcileOpenIncidents(tx, {
        processedSlot: 121,
      });
    });

    // Load the single incident row after both batches are applied.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });

    // The incident opens on the first slot and ends up containing both validators after both batches apply.
    expect(incident.status).toBe('open');
    expect(incident.openedSlot).toBe(120);
    expect(incident.validatorIndexes).toEqual([101, 102]);
    expect(incident.openedNotificationQueuedAt).toBeNull();

    // The indexer no longer enqueues Telegram notifications directly.
    expect(await prisma.notificationQueue.count()).toBe(0);
  });

  // This scenario proves the set-based reconciler can add one inactive validator and observe another
  // recover without shrinking the cumulative validator set stored on the open incident.
  it('keeps an incident open with the cumulative affected validator set when one validator recovers and another remains inactive', async () => {
    // Seed a second validator and attach it to the shared cluster for the new inactive member.
    await prisma.validator.create({
      data: {
        id: 102,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });
    await prisma.clusterValidator.create({
      data: {
        clusterId: CLUSTER_ID,
        validatorIndex: 102,
      },
    });

    // Seed the pre-existing open incident that currently tracks validator 101.
    await seedOpenIncidentForCluster(CLUSTER_ID, [VALIDATOR_INDEX], 119);

    // Keep validator 102 inactive while validator 101 has already recovered.
    await seedSnapshotState(VALIDATOR_INDEX, {
      isInactive: false,
      inactiveSinceSlot: null,
    });
    await seedSnapshotState(102, {
      isInactive: true,
      inactiveSinceSlot: 120,
    });

    // Reconcile from the current snapshot state after processing the recovery slot.
    await prisma.$transaction(async (tx) => {
      await incidentStorage.reconcileOpenIncidents(tx, {
        processedSlot: 123,
      });
    });

    // Read back the cluster incidents after both deltas are applied.
    const incidents = await prisma.clusterIncident.findMany({
      where: { clusterId: CLUSTER_ID },
      orderBy: { openedSlot: 'asc' },
    });

    // The original incident stays open and still keeps both validators for later reward attribution.
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.status).toBe('open');
    expect(incidents[0]?.openedSlot).toBe(119);
    expect(incidents[0]?.validatorIndexes).toEqual([101, 102]);
  });
});
