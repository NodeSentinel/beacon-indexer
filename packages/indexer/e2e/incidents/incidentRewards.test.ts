import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { ValidatorRewardsProgressController } from '@/src/services/consensus/controllers/validatorRewardsProgress.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import { IncidentTrackerStorage } from '@/src/services/consensus/storage/incidentTracker.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';
import { ValidatorRewardsProgressStorage } from '@/src/services/consensus/storage/validatorRewardsProgress.js';

// This suite verifies incident reward finalization from validator-scoped reward snapshots.
describe('Incident Rewards', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let validatorActivityStatusController: ValidatorActivityStatusController;
  let incidentTrackerController: IncidentTrackerController;
  let validatorRewardsProgressController: ValidatorRewardsProgressController;

  const VALIDATOR_INDEX = 101;
  const CLUSTER_ID = 'cluster-a';
  const USER_ID = 'incident-user';

  beforeAll(async () => {
    // The suite runs against a real PostgreSQL database.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    // Disconnect Prisma so Vitest can exit cleanly.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Recreate the worker dependencies from a clean clock state for each scenario.
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 0,
      delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
    });

    const incidentStorage = new IncidentStorage(prisma, {
      genesisTimeSec: Math.floor(gnosisConfig.beacon.genesisTimestamp / 1000),
      secPerSlot: Math.floor(gnosisConfig.beacon.slotDuration / 1000),
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
    });

    validatorActivityStatusController = new ValidatorActivityStatusController(
      new ValidatorActivityStatusStorage(prisma),
      beaconTime,
    );

    incidentTrackerController = new IncidentTrackerController(
      new IncidentTrackerStorage(prisma, incidentStorage),
    );

    validatorRewardsProgressController = new ValidatorRewardsProgressController(
      new ValidatorRewardsProgressStorage(
        prisma,
        {
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        },
        incidentStorage,
      ),
    );

    // Clear the tables touched by this suite so each scenario stays isolated.
    await prisma.notificationQueue.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
    await prisma.validatorSyncRewards.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "epoch_rewards"`);
    await prisma.slot.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.validator.deleteMany({});

    // Recreate wide partitions for the committee and epoch reward test fixtures.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
    );
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'epoch_rewards'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS epoch_rewards_test_partition PARTITION OF epoch_rewards FOR VALUES FROM (0) TO (100000000)`,
    );

    // Seed the shared user, cluster, validator, and base snapshot row used by every test.
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
        missedAttestationThreshold: 3,
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

    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: VALIDATOR_INDEX,
        status: 'active',
        consecutiveMissedAttestations: 0,
        currentMissedStreakStartSlot: null,
        lastObservedSlot: null,
        lastAttestedSlot: null,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: null,
        missedConsensusRewardsTotal: BigInt(0),
        missedSyncRewardsTotal: BigInt(0),
        missedAttestationsRewardsTotal: BigInt(0),
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });
  });

  // This helper inserts a run of missed duties for the shared validator.
  async function seedCommitteeMisses(slots: number[]) {
    for (const [index, slot] of slots.entries()) {
      await prisma.$executeRaw`
        INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
        VALUES (${slot}, ${index}, ${VALIDATOR_INDEX}, ${index}, ${null})
      `;
    }
  }

  // This helper inserts one successful duty for the shared validator.
  async function seedCommitteeHit(slot: number) {
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES (${slot}, ${99}, ${VALIDATOR_INDEX}, ${99}, ${1})
    `;
  }

  // This helper marks a slot range as fully indexed so the workers can advance.
  async function seedIndexedSlots(fromSlot: number, toSlot: number) {
    for (let slot = fromSlot; slot <= toSlot; slot += 1) {
      await prisma.slot.create({
        data: {
          slot,
          processed: true,
          attestationsFetched: true,
        },
      });
    }
  }

  // This scenario proves incident closure waits for validator reward progress,
  // then finalizes from the stored validator reward snapshots and queues the
  // close notification exactly once.
  it('finalizes a closed incident after validator reward progress catches up', async () => {
    // Seed an incident lifecycle: three misses open it, then one hit closes it.
    await seedCommitteeMisses([100, 101, 102]);
    await seedCommitteeHit(103);
    await seedIndexedSlots(100, 104);

    // Seed one epoch reward row with 10 units of missed attestation reward.
    await prisma.epochRewards.create({
      data: {
        epoch: Math.floor(100 / gnosisConfig.beacon.slotsPerEpoch),
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

    // Seed one missed sync reward and one earned sync reward in the same window.
    await prisma.validatorSyncRewards.createMany({
      data: [
        {
          slot: 102,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-5),
        },
        {
          slot: 103,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(9),
        },
      ],
    });

    // Keep the validator activity worker inside the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(105);

    // First refresh the validator facts, then open and close the cluster incident.
    await validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot: 104,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 104,
      maxAttestationDelay: 1,
    });

    // The cluster incident should be closed but still waiting for reward finalization.
    const closedBeforeRewards = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    expect(closedBeforeRewards.status).toBe('closed');
    expect(closedBeforeRewards.rewardsFinalized).toBe(false);
    expect(closedBeforeRewards.openedValidatorRewardTotals).not.toBeNull();
    expect(closedBeforeRewards.closedValidatorRewardTotals).toBeNull();
    expect(
      await prisma.notificationQueue.count({
        where: { type: 'incident_closed' },
      }),
    ).toBe(0);

    // Advance validator reward progress through the close slot.
    await validatorRewardsProgressController.syncValidatorRewardsProgress({
      processThroughSlot: 103,
    });

    // Load the finalized incident, validator cursor, and queued notification.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });
    const notification = await prisma.notificationQueue.findFirstOrThrow({
      where: { type: 'incident_closed' },
    });

    expect(incident.missedConsensusRewards).toBe(BigInt(15));
    expect(incident.rewardsFinalized).toBe(true);
    expect(incident.rewardsFinalizedAt).not.toBeNull();
    expect(incident.closedValidatorRewardTotals).not.toBeNull();
    expect(snapshot.rewardsProcessedThroughSlot).toBe(103);
    expect(snapshot.missedConsensusRewardsTotal).toBe(BigInt(15));
    expect((notification.payload as Record<string, unknown>).missedConsensusRewards).toBe('15');
  });

  // This scenario proves the migration guard does not re-notify legacy closed
  // incidents that do not carry the new validator reward snapshots.
  it('does not re-notify legacy closed incidents that lack validator reward snapshots', async () => {
    // Seed one legacy closed incident that predates the new snapshot-based flow.
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'closed',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(100)),
        openedSlot: 100,
        closedAt: new Date(beaconTime.getTimestampFromSlotNumber(103)),
        closedSlot: 103,
        durationSlots: 3,
        durationSeconds: 18,
        validatorIndexes: [VALIDATOR_INDEX],
      },
    });

    // Run the validator rewards worker with no new reward rows.
    await validatorRewardsProgressController.syncValidatorRewardsProgress({
      processThroughSlot: 103,
    });

    // The legacy incident should remain untouched and no close notification should appear.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    expect(incident.rewardsFinalized).toBe(false);
    expect(incident.closedNotificationQueuedAt).toBeNull();
    expect(
      await prisma.notificationQueue.count({
        where: { type: 'incident_closed' },
      }),
    ).toBe(0);
  });
});
