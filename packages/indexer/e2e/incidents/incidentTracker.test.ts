import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import { IncidentTrackerStorage } from '@/src/services/consensus/storage/incidentTracker.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies the new sequential incident tracker path end to end.
describe('Incident Tracker', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let validatorActivityStatusController: ValidatorActivityStatusController;
  let incidentTrackerController: IncidentTrackerController;

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

  afterEach(async () => {
    // Remove the broad committee partition so later suites can create real slot partitions.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
  });

  beforeEach(async () => {
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

    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
    );

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
        lastObservedSlot: null,
        lastAttestedSlot: null,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: null,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 0,
        attestationsMissed: 0,
      },
    });
  });

  // This helper seeds the durable tracker cursor so scenarios can start from a precise slot.
  async function seedIncidentProcessorState(processor: string, lastProcessedSlot: number) {
    await prisma.incidentProcessorState.create({
      data: {
        processor,
        lastProcessedSlot,
      },
    });
  }

  // This helper inserts missed duties for the shared validator.
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

  // This helper marks slots as fully indexed so the workers can process the same range.
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

  // This scenario proves open incidents do not get stranded when the cluster later has zero tracked memberships.
  it('closes an existing open incident when the cluster has zero current tracked memberships', async () => {
    // Seed the durable tracker cursor so this run starts after the incident was opened.
    await seedIncidentProcessorState('incident-tracker', 104);

    // Create an already-open incident that still points at the cluster.
    await prisma.clusterIncident.create({
      data: {
        clusterId: CLUSTER_ID,
        status: 'open',
        openedAt: new Date(beaconTime.getTimestampFromSlotNumber(100)),
        openedSlot: 100,
        validatorIndexes: [VALIDATOR_INDEX],
      },
    });

    // Remove the cluster membership to simulate a validator exit or explicit unlink while the incident is open.
    await prisma.clusterValidator.deleteMany({
      where: { clusterId: CLUSTER_ID, validatorIndex: VALIDATOR_INDEX },
    });

    // Mark the follow-up slots as indexed so the tracker can advance its cursor.
    await seedIndexedSlots(105, 106);

    // Run the tracker over the next safe range and let it revisit the stranded open incident.
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 106,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // The incident should now be closed even though the cluster currently has no tracked validators.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });

    expect(incident.status).toBe('closed');
    expect(incident.closedSlot).toBe(105);
  });

  // This scenario proves the new tracker reconstructs open and close slots from the durable cursor.
  it('opens and closes incidents using the sequential processor cursor', async () => {
    // Start the durable cursor immediately before the missed-duty streak begins.
    await seedIncidentProcessorState('incident-tracker', 99);
    // Create four missed duties followed by one successful attestation.
    await seedCommitteeMisses([100, 101, 102, 103]);
    await seedCommitteeHit(104);
    // Mark the relevant slots as indexed so both workers can process them.
    await seedIndexedSlots(100, 105);

    // Keep the freshness gate open for the validator activity updater.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(106);

    // First update the current validator activity state from the indexed committee data.
    await validatorActivityStatusController.syncCurrentActivityStatus({
      lastIndexedSlot: 105,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Then advance the durable incident tracker across the same indexed range.
    await incidentTrackerController.syncTrackedIncidents({
      lastIndexedSlot: 105,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Read back the incident, cursor, and snapshot rows to verify the end-to-end state transition.
    const incident = await prisma.clusterIncident.findFirstOrThrow({
      where: { clusterId: CLUSTER_ID },
    });
    const processorState = await prisma.incidentProcessorState.findUniqueOrThrow({
      where: { processor: 'incident-tracker' },
    });
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: VALIDATOR_INDEX },
    });

    expect(incident.status).toBe('closed');
    expect(incident.openedSlot).toBe(100);
    expect(incident.closedSlot).toBe(104);
    expect(processorState.lastProcessedSlot).toBe(104);
    expect(snapshot.isInactive).toBe(false);
    expect(snapshot.consecutiveMissedAttestations).toBe(0);
  });
});
