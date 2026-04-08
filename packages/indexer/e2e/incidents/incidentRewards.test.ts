import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import { IncidentRewardsStorage } from '@/src/services/consensus/storage/incidentRewards.js';
import { IncidentTrackerStorage } from '@/src/services/consensus/storage/incidentTracker.js';
import type { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies reward finalization and close notifications on the new tracker path.
describe('Incident Rewards', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let validatorActivityStatusController: ValidatorActivityStatusController;
  let incidentTrackerController: IncidentTrackerController;
  let incidentRewardsController: IncidentRewardsController;
  let slotStorage: SlotStorage;

  const VALIDATOR_INDEX = 101;
  const CLUSTER_ID = 'cluster-a';
  const USER_ID = 'incident-user';

  beforeAll(async () => {
    // This suite requires the real PostgreSQL test database.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    // Always disconnect Prisma at the end so Vitest can exit cleanly.
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Remove the broad raw-table partitions so later suites can create real ranges.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'epoch_rewards'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
  });

  beforeEach(async () => {
    // Rebuild the clock and workers from scratch for each scenario.
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 0,
      delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
    });

    // Provide the controller dependency required by the new controller-level runSync boundary.
    slotStorage = {
      getLastProcessedSlot: vi.fn(),
    } as unknown as SlotStorage;

    const incidentStorage = new IncidentStorage(prisma, {
      genesisTimeSec: Math.floor(gnosisConfig.beacon.genesisTimestamp / 1000),
      secPerSlot: Math.floor(gnosisConfig.beacon.slotDuration / 1000),
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
    });

    validatorActivityStatusController = new ValidatorActivityStatusController(
      new ValidatorActivityStatusStorage(prisma),
      slotStorage,
      beaconTime,
    );

    incidentTrackerController = new IncidentTrackerController(
      new IncidentTrackerStorage(prisma, incidentStorage),
      slotStorage,
    );

    incidentRewardsController = new IncidentRewardsController(
      new IncidentRewardsStorage(prisma, {
        slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      }),
      slotStorage,
    );

    // Clear only the tables this suite touches.
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

    // Recreate broad partitions so raw inserts succeed for every seeded slot and epoch.
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

    // Seed the shared user, cluster, validator, and snapshot row.
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

    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: VALIDATOR_INDEX,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: null,
        consecutiveMissedAttestations: 0,
        lastAttestedSlot: null,
        lastMissedAttestationSlot: null,
        missedRewardsProcessedThroughSlot: null,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });
  });

  // This helper inserts missed duties for the shared validator.
  async function seedCommitteeMisses(slots: number[]) {
    for (const [index, slot] of slots.entries()) {
      await prisma.$executeRaw`
        INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
        VALUES (${slot}, ${index}, ${VALIDATOR_INDEX}, ${index}, ${null})
      `;
    }
  }

  // This helper inserts one attested duty for the shared validator.
  async function seedCommitteeHit(slot: number) {
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES (${slot}, ${99}, ${VALIDATOR_INDEX}, ${99}, ${1})
    `;
  }

  // This helper marks slots as indexed so both workers can advance.
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

  // This scenario proves the close notification is deferred until the reward worker finalizes the incident.
  it('finalizes closed incidents and queues close notifications with reward values', async () => {
    // Create an inactivity streak that opens an incident and a later hit that closes it.
    await seedCommitteeMisses([100, 101, 102, 103]);
    await seedCommitteeHit(104);

    // Mark the surrounding slots as indexed so both workers can process the same window.
    await seedIndexedSlots(100, 105);

    // Seed consensus-layer reward misses that the reward worker should aggregate onto the incident.
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

    // Seed sync committee penalties in the same time range to prove both reward sources are included.
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

    // Keep the validator activity updater inside the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(106);

    // Refresh current liveness state from the indexed committee data.
    await validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot: 105,
      skipValidatorStatusUpdateWhenBehindHeadSlots: gnosisConfig.beacon.slotsPerEpoch,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Advance the tracker so it opens and closes the incident on the durable path.
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 105,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the incident is closed but still waiting for reward finalization and close notification enqueueing.
    const closedBeforeRewards = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    expect(closedBeforeRewards.status).toBe('closed');
    expect(closedBeforeRewards.rewardsFinalized).toBe(false);
    expect(
      await prisma.notificationQueue.count({
        where: { type: 'incident_closed' },
      }),
    ).toBe(0);

    // Run the reward worker through the closing slot so it finalizes totals and queues the close notification.
    await incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot: 104,
    });

    // Load the finalized incident, validator snapshot cursor, and queued notification for assertions.
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
    expect(snapshot.missedRewardsProcessedThroughSlot).toBe(104);
    expect((notification.payload as Record<string, unknown>).missedConsensusRewards).toBe('15');
  });

  // This scenario proves the reward cursor only applies the unprocessed reward range.
  it('advances incident rewards from missedRewardsProcessedThroughSlot without reapplying older rewards', async () => {
    const slotsPerEpoch = gnosisConfig.beacon.slotsPerEpoch;
    const openedSlot = 3 * slotsPerEpoch;
    const processedThroughSlot = 4 * slotsPerEpoch - 1;
    const firstUnprocessedSlot = processedThroughSlot + 1;
    const processThroughSlot = firstUnprocessedSlot + Math.floor(slotsPerEpoch / 2);

    // Seed an already-open incident with a previously accumulated reward total.
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(openedSlot)),
        openedSlot,
        validatorIndexes: [VALIDATOR_INDEX],
        missedConsensusRewards: BigInt(20),
      },
    });

    // Mark rewards through the end of epoch 3 as already processed for this validator.
    await prisma.validatorsSnapshotStats.update({
      where: { validatorIndex: VALIDATOR_INDEX },
      data: {
        missedRewardsProcessedThroughSlot: processedThroughSlot,
      },
    });

    // Seed an older epoch reward that must be ignored because it is already behind the cursor.
    await prisma.epochRewards.create({
      data: {
        epoch: 3,
        validatorIndex: VALIDATOR_INDEX,
        head: BigInt(0),
        target: BigInt(0),
        source: BigInt(0),
        inactivity: BigInt(0),
        missedHead: BigInt(40),
        missedTarget: BigInt(30),
        missedSource: BigInt(20),
        missedInactivity: BigInt(10),
      },
    });

    // Seed a new epoch reward that falls after the processed cursor and should be applied.
    await prisma.epochRewards.create({
      data: {
        epoch: 4,
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

    // Seed one missed sync reward inside the new range and one before it that must be ignored.
    await prisma.validatorSyncRewards.createMany({
      data: [
        {
          slot: processedThroughSlot,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-100),
        },
        {
          slot: processThroughSlot,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-5),
        },
      ],
    });

    // Run the reward worker only through the partial epoch 4 window.
    await incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot,
    });

    // Confirm only the new epoch reward and the in-range sync penalty were applied.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });

    expect(incident.missedConsensusRewards).toBe(BigInt(35));
    expect(snapshot.missedRewardsProcessedThroughSlot).toBe(processThroughSlot);
  });
});
