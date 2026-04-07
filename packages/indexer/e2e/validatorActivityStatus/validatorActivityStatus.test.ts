import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies the fast validator activity updater against a real database.
describe('Validator Activity Status Updater', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let storage: ValidatorActivityStatusStorage;
  let controller: ValidatorActivityStatusController;

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
    storage = new ValidatorActivityStatusStorage(prisma);
    controller = new ValidatorActivityStatusController(storage, beaconTime);

    // Remove only the data touched by this suite, keeping the setup isolated and deterministic.
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);

    // Recreate a broad committee partition so the raw inserts succeed in every test.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
    );
  });

  // This helper seeds the snapshot row whose liveness columns the fast updater owns.
  async function seedSnapshotValidator(validatorIndex: number) {
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: 90,
        consecutiveMissedAttestations: 0,
        lastObservedSlot: 90,
        lastAttestedSlot: 90,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: 80,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });
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

  // This helper reads back the snapshot row after the updater runs.
  async function getSnapshot(validatorIndex: number) {
    return prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex },
    });
  }

  // This scenario preserves the Task 1 schema-lock coverage for the new snapshot fields.
  it('persists validator activity state and processor cursors', async () => {
    // Seed the validator snapshot row with the activity-tracking columns introduced by the refactor.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: 101,
        status: 'active',
        isInactive: false,
        inactiveSinceSlot: null,
        activeSinceSlot: 42,
        consecutiveMissedAttestations: 0,
        lastObservedSlot: 42,
        lastAttestedSlot: 41,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: 88,
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });

    // Seed the dedicated incident processor cursor row that Task 1 introduced.
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
    expect(snapshot.lastObservedSlot).toBe(42);
    expect(snapshot.lastAttestedSlot).toBe(41);
    expect(snapshot.lastMissedAttestationSlot).toBeNull();
    expect(snapshot.rewardsProcessedThroughSlot).toBe(88);
    expect(processorState.lastProcessedSlot).toBe(9001);
  });

  // This scenario proves stale indexed data aborts early and leaves current activity untouched.
  it('aborts without mutating snapshot state when the indexed committee window is stale', async () => {
    // Seed the validator row and enough committee misses that a fresh run would mark it inactive.
    await seedSnapshotValidator(101);
    await seedCommitteeMisses([120, 121, 122, 123], 101);

    // Simulate the chain head being too far ahead of the indexed slot.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(130);

    // Run the updater with a freshness threshold that the indexed slot fails.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 123,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the liveness columns remain exactly as they were before the stale run.
    const row = await getSnapshot(101);
    expect(row.isInactive).toBe(false);
    expect(row.consecutiveMissedAttestations).toBe(0);
    expect(row.lastObservedSlot).toBe(90);
    expect(row.lastAttestedSlot).toBe(90);
    expect(row.activeSinceSlot).toBe(90);
    expect(row.inactiveSinceSlot).toBeNull();
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
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
      inactiveMissedCount: 4,
    });

    // Confirm the updater took ownership of the current activity columns only.
    const row = await getSnapshot(101);
    expect(row.isInactive).toBe(true);
    expect(row.consecutiveMissedAttestations).toBe(4);
    expect(row.lastObservedSlot).toBe(123);
    expect(row.lastAttestedSlot).toBeNull();
    expect(row.lastMissedAttestationSlot).toBeNull();
    expect(row.status).toBe('active');
    expect(row.activeSinceSlot).toBe(90);
    expect(row.inactiveSinceSlot).toBeNull();
    expect(row.rewardsProcessedThroughSlot).toBe(80);
  });
});
