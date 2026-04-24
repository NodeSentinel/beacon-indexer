import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { IncidentRewardsStorage } from '@/src/services/consensus/storage/incidentRewards.js';
import type { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies reward finalization on the activity-owned incident path.
describe('Incident Rewards', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let validatorActivityStatusController: ValidatorActivityStatusController;
  let incidentRewardsController: IncidentRewardsController;
  let slotStorage: SlotStorage;

  const VALIDATOR_INDEX = 101;
  const CLUSTER_ID = 'cluster-a';
  const USER_ID = 'incident-user';
  const DROP_COMMITTEE_PARTITIONS_SQL = `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`;
  const DROP_EPOCH_REWARD_PARTITIONS_SQL = `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'epoch_rewards'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`;

  // This helper removes all temporary test partitions so each scenario starts
  // from the same clean partition layout.
  async function dropRawTestPartitions() {
    await prisma.$executeRawUnsafe(DROP_COMMITTEE_PARTITIONS_SQL);
    await prisma.$executeRawUnsafe(DROP_EPOCH_REWARD_PARTITIONS_SQL);
  }

  // This helper recreates broad partitions so seeded raw rows always have a
  // valid partition destination inside the isolated E2E database.
  async function createRawTestPartitions() {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (1000)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS epoch_rewards_test_partition PARTITION OF epoch_rewards FOR VALUES FROM (0) TO (100)`,
    );
  }

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
    await dropRawTestPartitions();
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

    // Provide the controller dependency required by the controller-level sync boundary.
    slotStorage = {
      getLastProcessedSlot: vi.fn(),
    } as unknown as SlotStorage;

    validatorActivityStatusController = new ValidatorActivityStatusController(
      new ValidatorActivityStatusStorage(
        prisma,
        {
          genesisTimeSec: Math.floor(gnosisConfig.beacon.genesisTimestamp / 1000),
          secPerSlot: Math.floor(gnosisConfig.beacon.slotDuration / 1000),
        },
        gnosisConfig.beacon.slotsPerEpoch,
      ),
      slotStorage,
    );

    incidentRewardsController = new IncidentRewardsController(
      new IncidentRewardsStorage(prisma, {
        slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      }),
      slotStorage,
      beaconTime,
    );

    // Clear only the tables this suite touches.
    await prisma.notificationQueue.deleteMany({});
    await prisma.clusterIncidentValidator.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.validatorActivityProcessorState.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotActivity.deleteMany({});
    await prisma.validatorSyncRewards.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "epoch_rewards"`);
    await prisma.slot.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.validator.deleteMany({});

    // Recreate broad partitions so raw inserts succeed for every seeded slot and epoch.
    await dropRawTestPartitions();
    await createRawTestPartitions();

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

    await prisma.validatorsSnapshotActivity.create({
      data: {
        validatorIndex: VALIDATOR_INDEX,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: null,
        consecutiveMissedAttestations: 0,
        missedStreakStartedAtSlot: null,
        missedRewardsProcessedThroughSlot: null,
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

  // This helper seeds an additional validator and attaches it to the shared cluster.
  async function seedClusterValidator(validatorIndex: number) {
    await prisma.validator.create({
      data: {
        id: validatorIndex,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });

    await prisma.clusterValidator.create({
      data: {
        clusterId: CLUSTER_ID,
        validatorIndex,
      },
    });

    await prisma.validatorsSnapshotActivity.create({
      data: {
        validatorIndex,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: null,
        consecutiveMissedAttestations: 0,
        missedStreakStartedAtSlot: null,
        missedRewardsProcessedThroughSlot: null,
      },
    });
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

  // This helper seeds one inactivity interval row for a validator inside an incident.
  async function seedIncidentInterval(params: {
    incidentId: string;
    validatorIndex: number;
    inactiveFromSlot: number;
    inactiveToSlot?: number | null;
    rewardsProcessedThroughSlot?: number | null;
    missedAttestationRewards?: bigint;
    missedSyncRewards?: bigint;
    missedConsensusRewards?: bigint;
  }) {
    await prisma.clusterIncidentValidator.create({
      data: {
        incidentId: params.incidentId,
        validatorIndex: params.validatorIndex,
        inactiveFromSlot: params.inactiveFromSlot,
        inactiveToSlot: params.inactiveToSlot ?? null,
        rewardsProcessedThroughSlot: params.rewardsProcessedThroughSlot ?? null,
        missedAttestationRewards: params.missedAttestationRewards ?? BigInt(0),
        missedSyncRewards: params.missedSyncRewards ?? BigInt(0),
        missedConsensusRewards: params.missedConsensusRewards ?? BigInt(0),
      },
    });
  }

  // This scenario proves the reward worker finalizes closed incidents without queuing notifications.
  it('finalizes closed incidents without enqueuing close notifications', async () => {
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

    // Refresh current liveness state from the indexed committee data.
    vi.mocked(slotStorage.getLastProcessedSlot).mockResolvedValue(105);
    await validatorActivityStatusController.syncCurrentActivityStatus({
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the activity processor already closed the incident before rewards are finalized.
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

    // Run the reward worker through the closing slot so it finalizes totals for the closed incident.
    await incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot: 104,
    });

    // Load the finalized incident and interval cursor for assertions.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const incidentValidator = await prisma.clusterIncidentValidator.findFirstOrThrow({
      where: { incidentId: incident.id, validatorIndex: VALIDATOR_INDEX },
    });

    expect(incident.missedAttestationRewards).toBe(BigInt(10));
    expect(incident.missedSyncRewards).toBe(BigInt(5));
    expect(incident.missedConsensusRewards).toBe(BigInt(15));
    expect(incidentValidator.missedAttestationRewards).toBe(BigInt(10));
    expect(incidentValidator.missedSyncRewards).toBe(BigInt(5));
    expect(incidentValidator.missedConsensusRewards).toBe(BigInt(15));
    expect(incident.rewardsFinalized).toBe(true);
    expect(incident.rewardsFinalizedAt).not.toBeNull();
    expect(incident.closedNotificationQueuedAt).toBeNull();
    expect(incidentValidator.rewardsProcessedThroughSlot).toBe(104);
    expect(incidentValidator.inactiveFromSlot).toBe(100);
    expect(incidentValidator.inactiveToSlot).toBe(104);
    expect(await prisma.notificationQueue.count()).toBe(0);
  });

  // This scenario proves the reward cursor only applies the unprocessed reward range.
  it('advances incident rewards from missedRewardsProcessedThroughSlot without reapplying older rewards', async () => {
    const slotsPerEpoch = gnosisConfig.beacon.slotsPerEpoch;
    const openedSlot = 3 * slotsPerEpoch;
    const processedThroughSlot = 4 * slotsPerEpoch - 1;
    const firstUnprocessedSlot = processedThroughSlot + 1;
    const processThroughSlot = firstUnprocessedSlot + Math.floor(slotsPerEpoch / 2);

    // Seed an already-open incident with a previously accumulated reward total.
    const incident = await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(openedSlot)),
        openedSlot,
      },
    });
    await seedIncidentInterval({
      incidentId: incident.id,
      validatorIndex: VALIDATOR_INDEX,
      inactiveFromSlot: openedSlot,
      rewardsProcessedThroughSlot: processedThroughSlot,
      missedAttestationRewards: BigInt(8),
      missedSyncRewards: BigInt(12),
      missedConsensusRewards: BigInt(20),
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
    const refreshedIncident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const incidentValidator = await prisma.clusterIncidentValidator.findFirstOrThrow({
      where: { incidentId: incident.id, validatorIndex: VALIDATOR_INDEX },
    });

    expect(refreshedIncident.missedAttestationRewards).toBe(BigInt(18));
    expect(refreshedIncident.missedSyncRewards).toBe(BigInt(17));
    expect(refreshedIncident.missedConsensusRewards).toBe(BigInt(35));
    expect(incidentValidator.missedAttestationRewards).toBe(BigInt(18));
    expect(incidentValidator.missedSyncRewards).toBe(BigInt(17));
    expect(incidentValidator.missedConsensusRewards).toBe(BigInt(35));
    expect(incidentValidator.rewardsProcessedThroughSlot).toBe(processThroughSlot);
  });

  // This scenario proves interval-based accounting starts from the validator's
  // own interval start even when the cluster incident opened earlier.
  it('uses inactiveFromSlot as the lower bound even when the incident opened earlier', async () => {
    const openedSlot = 64;
    const validatorInactiveSinceSlot = 96;
    const processThroughSlot = 100;

    // Seed an already-open incident whose cluster window started before this
    // validator actually became inactive.
    const incident = await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(openedSlot)),
        openedSlot,
      },
    });
    await seedIncidentInterval({
      incidentId: incident.id,
      validatorIndex: VALIDATOR_INDEX,
      inactiveFromSlot: validatorInactiveSinceSlot,
    });

    // Seed one sync penalty before the validator became inactive and one after
    // it so the lower-bound choice is observable in the final total.
    await prisma.validatorSyncRewards.createMany({
      data: [
        {
          slot: 80,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-100),
        },
        {
          slot: 97,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-5),
        },
      ],
    });

    // Run the reward worker through the later slot boundary.
    await incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot,
    });

    // Only the penalty inside the validator's own inactive window should be applied.
    const refreshedIncident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const incidentValidator = await prisma.clusterIncidentValidator.findFirstOrThrow({
      where: { incidentId: incident.id, validatorIndex: VALIDATOR_INDEX },
    });

    expect(refreshedIncident.missedAttestationRewards).toBe(BigInt(0));
    expect(refreshedIncident.missedSyncRewards).toBe(BigInt(5));
    expect(refreshedIncident.missedConsensusRewards).toBe(BigInt(5));
    expect(incidentValidator.missedAttestationRewards).toBe(BigInt(0));
    expect(incidentValidator.missedSyncRewards).toBe(BigInt(5));
    expect(incidentValidator.missedConsensusRewards).toBe(BigInt(5));
    expect(incidentValidator.rewardsProcessedThroughSlot).toBe(processThroughSlot);
  });

  // This scenario proves a recovered validator's closed interval still contributes
  // to reward accounting while the incident stays open for another validator.
  it('keeps attributing missed rewards from closed validator intervals while the incident remains open', async () => {
    const recoveredValidatorIndex = VALIDATOR_INDEX;
    const stillInactiveValidatorIndex = 102;

    // Seed a second validator so the cluster incident can remain open after the first validator recovers.
    await seedClusterValidator(stillInactiveValidatorIndex);

    // Seed an already-open incident that has observed both validators during its lifetime.
    const incident = await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(100)),
        openedSlot: 100,
      },
    });
    await seedIncidentInterval({
      incidentId: incident.id,
      validatorIndex: recoveredValidatorIndex,
      inactiveFromSlot: 100,
      inactiveToSlot: 103,
    });
    await seedIncidentInterval({
      incidentId: incident.id,
      validatorIndex: stillInactiveValidatorIndex,
      inactiveFromSlot: 100,
    });

    // Seed missed consensus rewards for the recovered validator during the still-open incident window.
    await prisma.epochRewards.create({
      data: {
        epoch: Math.floor(100 / gnosisConfig.beacon.slotsPerEpoch),
        validatorIndex: recoveredValidatorIndex,
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

    // Run the reward worker through the same slot boundary.
    await incidentRewardsController.syncOpenIncidentRewards({
      processThroughSlot: 103,
    });

    // The incident should remain open and still include the recovered validator's missed rewards.
    const refreshedIncident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const incidentValidators = await prisma.clusterIncidentValidator.findMany({
      where: { incidentId: incident.id },
      orderBy: [{ validatorIndex: 'asc' }, { inactiveFromSlot: 'asc' }],
    });

    expect(refreshedIncident.status).toBe('open');
    expect(incidentValidators.map((row) => row.validatorIndex)).toEqual([
      recoveredValidatorIndex,
      stillInactiveValidatorIndex,
    ]);
    expect(incidentValidators[0]?.inactiveToSlot).toBe(103);
    expect(refreshedIncident.missedAttestationRewards).toBe(BigInt(10));
    expect(refreshedIncident.missedSyncRewards).toBe(BigInt(0));
    expect(refreshedIncident.missedConsensusRewards).toBe(BigInt(10));
    expect(incidentValidators[0]?.missedAttestationRewards).toBe(BigInt(10));
    expect(incidentValidators[0]?.missedSyncRewards).toBe(BigInt(0));
    expect(incidentValidators[0]?.missedConsensusRewards).toBe(BigInt(10));
    expect(incidentValidators[1]?.missedAttestationRewards).toBe(BigInt(0));
    expect(incidentValidators[1]?.missedSyncRewards).toBe(BigInt(0));
    expect(incidentValidators[1]?.missedConsensusRewards).toBe(BigInt(0));
  });
});
