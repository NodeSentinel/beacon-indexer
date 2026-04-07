import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ValidatorRewardsProgressController } from '@/src/services/consensus/controllers/validatorRewardsProgress.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import { ValidatorRewardsProgressStorage } from '@/src/services/consensus/storage/validatorRewardsProgress.js';

// This suite verifies the validator-scoped reward progress worker end to end.
describe('Validator Rewards Progress', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let controller: ValidatorRewardsProgressController;

  const VALIDATOR_INDEX = 101;
  const USER_ID = 'rewards-user';
  const CLUSTER_A_ID = 'cluster-a';
  const CLUSTER_B_ID = 'cluster-b';

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
    // Recreate the chain clock and worker for each isolated scenario.
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 0,
      delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
    });

    controller = new ValidatorRewardsProgressController(
      new ValidatorRewardsProgressStorage(
        prisma,
        {
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        },
        new IncidentStorage(prisma, {
          genesisTimeSec: Math.floor(gnosisConfig.beacon.genesisTimestamp / 1000),
          secPerSlot: Math.floor(gnosisConfig.beacon.slotDuration / 1000),
          slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
        }),
      ),
    );

    // Clear the tables touched by this suite so each scenario stays isolated.
    await prisma.notificationQueue.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
    await prisma.validatorSyncRewards.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "epoch_rewards"`);
    await prisma.validator.deleteMany({});

    // Recreate one broad epoch_rewards partition for the test fixture range.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'epoch_rewards'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS epoch_rewards_test_partition PARTITION OF epoch_rewards FOR VALUES FROM (0) TO (100000000)`,
    );

    // Seed the shared validator and its base snapshot row.
    await prisma.validator.create({
      data: {
        id: VALIDATOR_INDEX,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
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

  // This helper seeds the shared user and one cluster membership.
  async function seedCluster(params: { clusterId: string }) {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: {
        id: USER_ID,
        username: 'rewards-user',
        telegramId: BigInt(123456),
        hasBlockedBot: false,
      },
    });

    await prisma.cluster.create({
      data: {
        id: params.clusterId,
        name: params.clusterId,
        ownerId: USER_ID,
        missedAttestationThreshold: 3,
      },
    });

    await prisma.clusterValidator.create({
      data: {
        clusterId: params.clusterId,
        validatorIndex: VALIDATOR_INDEX,
      },
    });
  }

  // This scenario proves the worker only applies the unprocessed reward range
  // after the validator cursor.
  it('advances validator reward totals incrementally from rewardsProcessedThroughSlot', async () => {
    const slotsPerEpoch = gnosisConfig.beacon.slotsPerEpoch;
    const processedThroughSlot = 3 * slotsPerEpoch - 1;
    const processThroughSlot = 4 * slotsPerEpoch + 5;

    // Mark rewards through epoch 2 as already processed and preseed prior totals.
    await prisma.validatorsSnapshotStats.update({
      where: { validatorIndex: VALIDATOR_INDEX },
      data: {
        rewardsProcessedThroughSlot: processedThroughSlot,
        missedConsensusRewardsTotal: BigInt(20),
        missedSyncRewardsTotal: BigInt(8),
        missedAttestationsRewardsTotal: BigInt(12),
      },
    });

    // Seed an old epoch reward that should be ignored because it sits behind the cursor.
    await prisma.epochRewards.create({
      data: {
        epoch: 2,
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

    // Seed a new epoch reward that falls after the cursor and should be applied.
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

    // Seed sync rewards on both sides of the cursor to prove only the new window is consumed.
    await prisma.validatorSyncRewards.createMany({
      data: [
        {
          slot: processedThroughSlot - 4,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-9),
        },
        {
          slot: processedThroughSlot + 2,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(-5),
        },
        {
          slot: processedThroughSlot + 3,
          validatorIndex: VALIDATOR_INDEX,
          syncCommittee: BigInt(11),
        },
      ],
    });

    // Advance validator reward progress through the requested slot.
    await controller.syncValidatorRewardsProgress({
      processThroughSlot,
    });

    // The worker should have applied only the epoch-4 row plus the new negative sync reward.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });
    expect(snapshot.rewardsProcessedThroughSlot).toBe(processThroughSlot);
    expect(snapshot.missedAttestationsRewardsTotal).toBe(BigInt(22));
    expect(snapshot.missedSyncRewardsTotal).toBe(BigInt(13));
    expect(snapshot.missedConsensusRewardsTotal).toBe(BigInt(35));
  });

  // This scenario proves the worker refuses to advance the validator cursor when
  // epoch rewards are still missing for the requested slot range.
  it('does not advance the validator cursor when epoch rewards are not available yet', async () => {
    const processThroughSlot = 100;

    // Seed only sync penalties without the matching epoch reward row.
    await prisma.validatorSyncRewards.create({
      data: {
        slot: 99,
        validatorIndex: VALIDATOR_INDEX,
        syncCommittee: BigInt(-5),
      },
    });

    // Run the worker through the target slot range.
    await controller.syncValidatorRewardsProgress({
      processThroughSlot,
    });

    // The worker should leave both the cursor and totals untouched.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });
    expect(snapshot.rewardsProcessedThroughSlot).toBeNull();
    expect(snapshot.missedSyncRewardsTotal).toBe(BigInt(0));
    expect(snapshot.missedAttestationsRewardsTotal).toBe(BigInt(0));
    expect(snapshot.missedConsensusRewardsTotal).toBe(BigInt(0));
  });

  // This scenario proves a validator shared by multiple clusters still advances
  // reward progress exactly once at the validator level.
  it('does not double-consume validator rewards when one validator belongs to multiple clusters', async () => {
    // Seed two clusters that share the same validator.
    await seedCluster({ clusterId: CLUSTER_A_ID });
    await seedCluster({ clusterId: CLUSTER_B_ID });

    // Seed one epoch reward row and one missed sync penalty for the shared validator.
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
    await prisma.validatorSyncRewards.create({
      data: {
        slot: 100,
        validatorIndex: VALIDATOR_INDEX,
        syncCommittee: BigInt(-5),
      },
    });

    // Seed two already-closed incidents that both reference the same validator.
    const openedAt = new Date(beaconTime.getTimestampFromSlotNumber(100));
    const closedAt = new Date(beaconTime.getTimestampFromSlotNumber(103));
    for (const clusterId of [CLUSTER_A_ID, CLUSTER_B_ID]) {
      await prisma.clusterIncident.create({
        data: {
          clusterId,
          status: 'closed',
          openedAt,
          openedSlot: 100,
          closedAt,
          closedSlot: 103,
          durationSlots: 3,
          durationSeconds: 18,
          validatorIndexes: [VALIDATOR_INDEX],
          openedValidatorRewardTotals: {
            [String(VALIDATOR_INDEX)]: {
              missedConsensusRewardsTotal: '0',
              missedSyncRewardsTotal: '0',
              missedAttestationsRewardsTotal: '0',
            },
          },
        },
      });
    }

    // Advance validator reward progress once for the shared validator.
    await controller.syncValidatorRewardsProgress({
      processThroughSlot: 103,
    });

    // The validator totals should have advanced once, even though two incidents consumed them.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });
    const incidents = await prisma.clusterIncident.findMany({
      where: {
        clusterId: {
          in: [CLUSTER_A_ID, CLUSTER_B_ID],
        },
      },
      orderBy: { clusterId: 'asc' },
    });

    expect(snapshot.missedConsensusRewardsTotal).toBe(BigInt(15));
    expect(snapshot.missedSyncRewardsTotal).toBe(BigInt(5));
    expect(snapshot.missedAttestationsRewardsTotal).toBe(BigInt(10));
    expect(incidents).toHaveLength(2);
    expect(incidents[0]!.missedConsensusRewards).toBe(BigInt(15));
    expect(incidents[1]!.missedConsensusRewards).toBe(BigInt(15));
  });
});
