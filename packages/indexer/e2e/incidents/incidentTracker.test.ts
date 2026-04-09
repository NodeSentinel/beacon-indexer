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
});
