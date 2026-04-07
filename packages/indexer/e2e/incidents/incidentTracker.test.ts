import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import { IncidentTrackerStorage } from '@/src/services/consensus/storage/incidentTracker.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies cluster-scoped incident tracking on top of validator-owned
// streak facts and per-cluster thresholds.
describe('Incident Tracker', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let validatorActivityStatusController: ValidatorActivityStatusController;
  let incidentTrackerController: IncidentTrackerController;

  const VALIDATOR_INDEX = 101;
  const USER_ID = 'incident-user';
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
    // Recreate the worker dependencies from a clean clock state each time.
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: 0,
      delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
    });

    validatorActivityStatusController = new ValidatorActivityStatusController(
      new ValidatorActivityStatusStorage(prisma),
      beaconTime,
    );

    incidentTrackerController = new IncidentTrackerController(
      new IncidentTrackerStorage(
        prisma,
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
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.validatorsSnapshotStats.deleteMany({});
    await prisma.slot.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.validator.deleteMany({});

    // Recreate one broad committee partition for the test slot range.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
    );

    // Seed the shared user and validator referenced by every scenario.
    await prisma.user.create({
      data: {
        id: USER_ID,
        username: 'incident-user',
        telegramId: BigInt(123456),
        hasBlockedBot: false,
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

  // This helper creates a cluster with a custom missed-attestation threshold.
  async function seedCluster(params: { clusterId: string; threshold: number }) {
    await prisma.cluster.create({
      data: {
        id: params.clusterId,
        name: params.clusterId,
        ownerId: USER_ID,
        missedAttestationThreshold: params.threshold,
      },
    });

    await prisma.clusterValidator.create({
      data: {
        clusterId: params.clusterId,
        validatorIndex: VALIDATOR_INDEX,
      },
    });
  }

  // This helper seeds one tracker cursor row.
  async function seedIncidentProcessorState(processor: string, lastProcessedSlot: number) {
    await prisma.incidentProcessorState.create({
      data: {
        processor,
        lastProcessedSlot,
      },
    });
  }

  // This helper inserts a run of missed committee duties for the shared validator.
  async function seedCommitteeMisses(slots: number[]) {
    for (const [index, slot] of slots.entries()) {
      await prisma.$executeRaw`
        INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
        VALUES (${slot}, ${index}, ${VALIDATOR_INDEX}, ${index}, ${null})
      `;
    }
  }

  // This helper inserts one successful attestation duty for the shared validator.
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

  // This scenario proves open incidents do not get stranded when cluster
  // membership disappears while the incident is still open.
  it('closes an open incident when the cluster now has zero tracked memberships', async () => {
    // Seed one thresholded cluster and an already-open incident.
    await seedCluster({ clusterId: CLUSTER_A_ID, threshold: 3 });
    await seedIncidentProcessorState('incident-tracker', 104);
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_A_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(100)),
        openedSlot: 100,
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

    // Remove the cluster membership to simulate an exit or unlink after opening.
    await prisma.clusterValidator.deleteMany({
      where: { clusterId: CLUSTER_A_ID, validatorIndex: VALIDATOR_INDEX },
    });

    // Mark the following slots as indexed so the tracker can advance its cursor.
    await seedIndexedSlots(105, 106);

    // Run the tracker through the next safe range.
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 106,
      maxAttestationDelay: 1,
    });

    // The incident should now be closed at the first slot after the stored cursor.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_A_ID },
    });
    expect(incident.status).toBe('closed');
    expect(incident.closedSlot).toBe(105);
  });

  // This scenario proves the tracker reconstructs the exact open and close slot
  // boundaries from the sequential cursor and per-cluster threshold.
  it('opens and closes incidents with exact slot boundaries derived from the cluster threshold', async () => {
    // Seed one cluster with a threshold of three consecutive missed duties.
    await seedCluster({ clusterId: CLUSTER_A_ID, threshold: 3 });

    // Start the durable cursor immediately before the streak begins.
    await seedIncidentProcessorState('incident-tracker', 99);

    // Seed three misses followed by one successful attestation.
    await seedCommitteeMisses([100, 101, 102]);
    await seedCommitteeHit(103);

    // Mark the surrounding slots as indexed for both workers.
    await seedIndexedSlots(100, 104);

    // Keep the validator activity worker inside the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(105);

    // Refresh the validator-owned streak facts first.
    await validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot: 104,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });

    // Then advance the incident tracker over the same indexed window.
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 104,
      maxAttestationDelay: 1,
    });

    // Read back the incident, tracker cursor, and validator snapshot state.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_A_ID },
    });
    const processorState = await prisma.incidentProcessorState.findUniqueOrThrow({
      where: { processor: 'incident-tracker' },
    });
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });

    // Threshold three means the incident opens on the third missed duty.
    expect(incident.status).toBe('closed');
    expect(incident.openedSlot).toBe(102);
    expect(incident.closedSlot).toBe(103);
    expect(processorState.lastProcessedSlot).toBe(103);

    // The validator-owned streak facts remain objective and reset after the hit.
    expect(snapshot.consecutiveMissedAttestations).toBe(0);
    expect(snapshot.currentMissedStreakStartSlot).toBeNull();
    expect(snapshot.lastAttestedSlot).toBe(103);
  });

  // This scenario proves the same validator streak is interpreted differently by
  // different clusters without mutating the underlying validator facts.
  it('interprets one validator streak through each cluster threshold independently', async () => {
    // Seed two clusters that share the same validator but apply different thresholds.
    await seedCluster({ clusterId: CLUSTER_A_ID, threshold: 3 });
    await seedCluster({ clusterId: CLUSTER_B_ID, threshold: 5 });
    await seedIncidentProcessorState('incident-tracker', 99);

    // Seed four missed duties so the validator qualifies for threshold three but not five.
    await seedCommitteeMisses([100, 101, 102, 103]);
    await seedIndexedSlots(100, 104);

    // Keep the validator activity worker inside the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(105);

    // Refresh the validator facts and then let the tracker interpret them.
    await validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot: 104,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 104,
      maxAttestationDelay: 1,
    });

    // Cluster A should open on slot 102, while cluster B should still have no incident.
    const clusterAIncident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_A_ID },
    });
    const clusterBIncident = await prisma.clusterIncident.findFirst({
      where: { clusterId: CLUSTER_B_ID },
    });
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });

    expect(clusterAIncident.status).toBe('open');
    expect(clusterAIncident.openedSlot).toBe(102);
    expect(clusterBIncident).toBeNull();

    // The validator facts remain cluster-agnostic even though incident outcomes differ.
    expect(snapshot.consecutiveMissedAttestations).toBe(4);
    expect(snapshot.currentMissedStreakStartSlot).toBe(100);
  });
});
