import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { IncidentStorage } from '@/src/services/consensus/storage/incident.js';
import type { SlotStorage } from '@/src/services/consensus/storage/slot.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies the fast validator activity updater against a real database.
describe('Validator Activity Status Updater', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let storage: ValidatorActivityStatusStorage;
  let controller: ValidatorActivityStatusController;
  let incidentStorage: IncidentStorage;
  let slotStorage: SlotStorage;

  beforeAll(async () => {
    // The e2e suite uses the same live PostgreSQL setup as the other indexer integration tests.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    // Create the generated Prisma client so the updater runs against the real schema.
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    // Disconnect cleanly so the test process exits without open handles.
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Remove the dedicated broad partition created by this suite so retries start from a clean state.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS committee_test_partition CASCADE`);
  });

  beforeEach(async () => {
    // Reset the clock helper, storage, and controller for each scenario.
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
    storage = new ValidatorActivityStatusStorage(
      prisma,
      incidentStorage,
      gnosisConfig.beacon.slotsPerEpoch,
    );

    // Provide the controller dependency required by the new controller-level runSync boundary.
    slotStorage = {
      getLastProcessedSlot: vi.fn(),
    } as unknown as SlotStorage;
    controller = new ValidatorActivityStatusController(storage, slotStorage, beaconTime);

    // Remove only the data touched by this suite, keeping the setup isolated and deterministic.
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.clusterIncident.deleteMany({});
    await prisma.clusterValidator.deleteMany({});
    await prisma.cluster.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);
    await prisma.validator.deleteMany({});

    // Recreate a broad committee partition so the raw inserts succeed in every test.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS committee_test_partition CASCADE`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (1000)`,
    );
  });

  // This helper seeds the snapshot row whose liveness columns the fast updater owns.
  async function seedSnapshotValidator(validatorIndex: number) {
    // Create the validator row first so cluster membership and snapshot state can reference it.
    await prisma.validator.upsert({
      where: { id: validatorIndex },
      update: {},
      create: {
        id: validatorIndex,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        status: 3,
      },
    });

    // Create the snapshot row whose current-activity fields the processor updates.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: 90,
        consecutiveMissedAttestations: 0,
        missedStreakStartedAtSlot: null,
        missedRewardsProcessedThroughSlot: 80,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });
  }

  // This helper creates a cluster and attaches the requested validators to it.
  async function seedClusterMembership(clusterId: string, validatorIndexes: number[]) {
    // Create the owner first so the cluster row can satisfy its foreign key.
    await prisma.user.create({
      data: {
        id: `${clusterId}-owner`,
        username: `${clusterId}-owner`,
        telegramId: BigInt(123456),
        hasBlockedBot: false,
      },
    });

    // Create the cluster that incident rows will belong to.
    await prisma.cluster.create({
      data: {
        id: clusterId,
        name: clusterId,
        ownerId: `${clusterId}-owner`,
      },
    });

    // Attach every validator to the cluster so incident reconciliation can discover memberships.
    for (const validatorIndex of validatorIndexes) {
      await prisma.clusterValidator.create({
        data: {
          clusterId,
          validatorIndex,
        },
      });
    }
  }

  // This helper inserts recent committee duties that were all missed for one validator.
  async function seedCommitteeMisses(slots: number[], validatorIndex: number) {
    for (const [index, slot] of slots.entries()) {
      await prisma.$executeRaw`
        INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
        VALUES (${slot}, ${index}, ${validatorIndex}, ${index}, ${null})
      `;
    }
  }

  // This helper inserts one successful committee duty for a validator.
  async function seedCommitteeSuccess(
    slot: number,
    validatorIndex: number,
    attestationDelay: number,
  ) {
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES (${slot}, ${slot}, ${validatorIndex}, ${slot}, ${attestationDelay})
    `;
  }

  // This helper reads back the snapshot row after the updater runs.
  async function getSnapshot(validatorIndex: number) {
    return prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex },
    });
  }

  // This helper reads the currently open incident for a cluster.
  async function getOpenIncident(clusterId: string) {
    return prisma.clusterIncident.findFirst({
      where: {
        clusterId,
        status: 'open',
      },
      orderBy: {
        openedSlot: 'asc',
      },
    });
  }

  // This helper reads the latest incident for a cluster regardless of status.
  async function getLatestIncident(clusterId: string) {
    return prisma.clusterIncident.findFirst({
      where: { clusterId },
      orderBy: {
        openedSlot: 'desc',
      },
    });
  }

  // This helper keeps the activity-sync call sites short in the slot-driven scenarios below.
  async function runActivitySyncThrough(
    lastIndexedSlot: number,
    maxAttestationDelay: number,
    inactiveMissedCount: number,
  ) {
    // Keep the indexed slot close enough to head so the freshness guard allows processing.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(
      lastIndexedSlot + maxAttestationDelay + 4,
    );

    // Run the same controller entrypoint the production worker uses.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot,
      skipValidatorStatusUpdateWhenBehindHeadSlots: gnosisConfig.beacon.slotsPerEpoch,
      maxAttestationDelay,
      inactiveMissedCount,
    });
  }

  // This scenario preserves the schema-lock coverage for the snapshot fields used by the global inactivity flow.
  it('persists validator activity state and processor cursors', async () => {
    // Seed the validator snapshot row with the activity-tracking columns.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: 101,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: 42,
        consecutiveMissedAttestations: 0,
        missedStreakStartedAtSlot: null,
        missedRewardsProcessedThroughSlot: 88,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });

    // Seed the dedicated incident processor cursor row used by the tracker.
    await prisma.incidentProcessorState.create({
      data: {
        processor: 'incident-tracker',
        lastProcessedSlot: 9001,
      },
    });

    // Read the rows back through Prisma so the test locks the generated schema surface.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: 101 },
    });
    const processorState = await prisma.incidentProcessorState.findUniqueOrThrow({
      where: { processor: 'incident-tracker' },
    });

    expect(snapshot.consecutiveMissedAttestations).toBe(0);
    expect(snapshot.missedRewardsProcessedThroughSlot).toBe(88);
    expect(processorState.lastProcessedSlot).toBe(9001);
  });

  // This scenario proves the processor still advances through already-safe duties even when head is far ahead.
  it('keeps processing safe indexed duties when the indexer is behind head', async () => {
    // Seed the validator row and enough committee misses that a safe run should mark it inactive.
    await seedSnapshotValidator(101);
    await seedCommitteeMisses([120, 121, 122, 123], 101);

    // Simulate the chain head being far ahead of the indexed slot.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(140);

    // Run the updater even though the live head is well ahead of the indexed boundary.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 124,
      skipValidatorStatusUpdateWhenBehindHeadSlots: gnosisConfig.beacon.slotsPerEpoch,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the safe duties were still applied to the activity snapshot.
    const row = await getSnapshot(101);
    expect(row.isInactive).toBe(true);
    expect(row.consecutiveMissedAttestations).toBe(4);
    expect(row.activeSinceSlot).toBe(90);
    expect(row.inactiveSinceSlot).toBe(120);
  });

  // This scenario proves fresh indexed committee data updates the current activity owner columns.
  it('updates current validator activity fields when the indexed committee window is fresh', async () => {
    // Seed the validator row and a run of recent committee misses inside the safe observation window.
    await seedSnapshotValidator(101);
    await seedCommitteeMisses([120, 121, 122, 123], 101);

    // Keep the head close enough that the freshness guard allows the sync to run.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(129);

    // Run the updater using the same indexed slot, now treated as fresh.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 124,
      skipValidatorStatusUpdateWhenBehindHeadSlots: gnosisConfig.beacon.slotsPerEpoch,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the updater took ownership of the current activity columns only.
    const row = await getSnapshot(101);
    expect(row.isInactive).toBe(true);
    expect(row.consecutiveMissedAttestations).toBe(4);
    expect(row.status).toBe('active');
    expect(row.activeSinceSlot).toBe(90);
    expect(row.inactiveSinceSlot).toBe(120);
    expect(row.missedRewardsProcessedThroughSlot).toBe(80);
  });

  // This scenario proves the updater uses the trailing missed streak, not total misses in the window.
  it('resets the missed streak after an attested duty inside the observation window', async () => {
    // Seed the validator row and a mixed sequence ordered oldest->newest as miss, attested, miss, miss.
    await seedSnapshotValidator(101);
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES
        (120, 0, 101, 0, ${null}),
        (121, 1, 101, 1, ${1}),
        (122, 2, 101, 2, ${null}),
        (123, 3, 101, 3, ${null})
    `;

    // Keep the indexed window fresh and include the newest duty in the safe observation slot.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(129);

    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 124,
      skipValidatorStatusUpdateWhenBehindHeadSlots: gnosisConfig.beacon.slotsPerEpoch,
      maxAttestationDelay: 1,
      inactiveMissedCount: 3,
    });

    // Only the trailing misses after the attested duty should count toward inactivity.
    const row = await getSnapshot(101);
    expect(row.consecutiveMissedAttestations).toBe(2);
    expect(row.isInactive).toBe(false);
  });

  // This scenario locks the exact slot where the activity processor should open a cluster incident.
  it('opens a cluster incident on the exact slot where the inactivity threshold is crossed', async () => {
    // Seed the validator snapshot row and connect it to one cluster.
    await seedSnapshotValidator(101);
    await seedClusterMembership('cluster-a', [101]);

    // Seed three missed duties so the third miss is the threshold-crossing event.
    await seedCommitteeMisses([120, 121, 122], 101);

    // Run the activity processor through the safe slot that includes slot 122.
    await runActivitySyncThrough(123, 1, 3);

    // Read back the snapshot row and the cluster's open incident.
    const snapshot = await getSnapshot(101);
    const incident = await getOpenIncident('cluster-a');

    // The snapshot and incident should agree on the exact opening slot.
    expect(snapshot.isInactive).toBe(true);
    expect(snapshot.inactiveSinceSlot).toBe(120);
    expect(incident?.openedSlot).toBe(120);
    expect(incident?.validatorIndexes).toEqual([101]);
  });

  // This scenario locks the exact slot where the activity processor should close the active incident.
  it('closes the open incident on the exact slot where the cluster becomes fully active again', async () => {
    // Seed the validator and cluster membership used by the incident row.
    await seedSnapshotValidator(101);
    await seedClusterMembership('cluster-a', [101]);

    // Move the snapshot row into the already-inactive state the recovery scenario starts from.
    await prisma.validatorsSnapshotStats.update({
      where: { validatorIndex: 101 },
      data: {
        isInactive: true,
        inactiveSinceSlot: 120,
        consecutiveMissedAttestations: 3,
        missedStreakStartedAtSlot: 120,
        activeSinceSlot: null,
      },
    });

    // Seed an open incident so the recovery run has something to close.
    await prisma.$transaction(async (tx) => {
      await incidentStorage.openIncidentIfMissing(tx, {
        clusterId: 'cluster-a',
        openedSlot: 120,
        validatorIndexes: [101],
      });
    });

    // Seed the successful duty that resets the missed-attestation streak.
    await seedCommitteeSuccess(123, 101, 1);

    // Run the activity processor through the recovery slot.
    await runActivitySyncThrough(124, 1, 3);

    // Read the updated snapshot row and latest incident after the recovery is processed.
    const snapshot = await getSnapshot(101);
    const incident = await getLatestIncident('cluster-a');

    // The validator should recover immediately and the incident should close at that same slot.
    expect(snapshot.isInactive).toBe(false);
    expect(snapshot.consecutiveMissedAttestations).toBe(0);
    expect(incident?.status).toBe('closed');
    expect(incident?.closedSlot).toBe(123);
  });

  // This scenario ensures the cluster incident remains open until the last inactive validator recovers.
  it('keeps the incident open until every validator in the cluster has recovered', async () => {
    // Seed two validators and connect both of them to the same cluster.
    await seedSnapshotValidator(101);
    await seedSnapshotValidator(102);
    await seedClusterMembership('cluster-a', [101, 102]);

    // Seed missed-duty streaks that cross the inactivity threshold on different slots.
    await seedCommitteeMisses([120, 121, 122], 101);
    await seedCommitteeMisses([121, 122, 123], 102);

    // Process the first batch so the cluster incident opens.
    await runActivitySyncThrough(124, 1, 3);

    // Recover only the first validator and process that intermediate state.
    await seedCommitteeSuccess(124, 101, 1);
    await runActivitySyncThrough(125, 1, 3);

    // Recover the second validator later and process the final closure.
    await seedCommitteeSuccess(125, 102, 1);
    await runActivitySyncThrough(126, 1, 3);

    // Read all incidents for the cluster in opening order.
    const incidents = await prisma.clusterIncident.findMany({
      where: { clusterId: 'cluster-a' },
      orderBy: {
        openedSlot: 'asc',
      },
    });

    // The incident should open at the first threshold-crossing slot and close only after the final recovery.
    expect(incidents[0]?.openedSlot).toBe(120);
    expect(incidents[0]?.closedSlot).toBe(125);
  });
});
