import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { ValidatorActivityStatusStorage } from '@/src/services/consensus/storage/validatorActivityStatus.js';

// This suite verifies the validator activity worker against the revised
// validator-owned snapshot contract.
describe('Validator Activity Status Updater', () => {
  let prisma: PrismaClient;
  let beaconTime: BeaconTime;
  let storage: ValidatorActivityStatusStorage;
  let controller: ValidatorActivityStatusController;

  beforeAll(async () => {
    // The suite uses the real Postgres-backed Prisma client so the schema
    // assertions cover the generated model surface, not mocked shapes.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    // Always close Prisma so Vitest can exit cleanly.
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Recreate the worker dependencies from a clean clock state for each test.
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

    // Remove only the rows touched by this suite so each scenario stays isolated.
    await prisma.incidentProcessorState.deleteMany({});
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "committee"`);

    // Recreate a broad committee partition so raw inserts succeed for every slot.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
    );
  });

  // This helper seeds one validator snapshot row using only the fields the new
  // validator activity worker owns or must preserve.
  async function seedSnapshotValidator(validatorIndex: number) {
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex,
        status: 'active',
        consecutiveMissedAttestations: 0,
        currentMissedStreakStartSlot: null,
        lastObservedSlot: 90,
        lastAttestedSlot: 90,
        lastMissedAttestationSlot: null,
        rewardsProcessedThroughSlot: 80,
        missedConsensusRewardsTotal: BigInt(15),
        missedSyncRewardsTotal: BigInt(5),
        missedAttestationsRewardsTotal: BigInt(10),
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });
  }

  // This helper inserts a run of missed committee duties for one validator.
  async function seedCommitteeMisses(slots: number[], validatorIndex: number) {
    for (const [index, slot] of slots.entries()) {
      await prisma.$executeRaw`
        INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
        VALUES (${slot}, ${index}, ${validatorIndex}, ${index}, ${null})
      `;
    }
  }

  // This helper reads the current snapshot row after the worker runs.
  async function getSnapshot(validatorIndex: number) {
    return prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex },
    });
  }

  // This scenario locks the generated Prisma schema for the new validator-owned
  // activity and reward accumulator fields.
  it('persists validator streak facts, reward accumulators, and the incident cursor state', async () => {
    // Seed one snapshot row with the new streak and reward accumulator fields.
    await prisma.validatorsSnapshotStats.create({
      data: {
        validatorIndex: 101,
        status: 'active',
        consecutiveMissedAttestations: 2,
        currentMissedStreakStartSlot: 41,
        lastObservedSlot: 42,
        lastAttestedSlot: 40,
        lastMissedAttestationSlot: 42,
        rewardsProcessedThroughSlot: 88,
        missedConsensusRewardsTotal: BigInt(15),
        missedSyncRewardsTotal: BigInt(5),
        missedAttestationsRewardsTotal: BigInt(10),
        balance: BigInt(32_000_000_000),
        effectiveBalance: BigInt(32_000_000_000),
        beaconStatus: 3,
        attestationsTotal: 1,
        attestationsMissed: 0,
      },
    });

    // Seed the dedicated incident processor cursor row that the tracker uses.
    await prisma.incidentProcessorState.create({
      data: {
        processor: 'incident-tracker',
        lastProcessedSlot: 9001,
      },
    });

    // Read both rows back through Prisma so the test locks the schema surface.
    const snapshot = await prisma.validatorsSnapshotStats.findUniqueOrThrow({
      where: { validatorIndex: 101 },
    });
    const processorState = await prisma.incidentProcessorState.findUniqueOrThrow({
      where: { processor: 'incident-tracker' },
    });

    expect(snapshot.consecutiveMissedAttestations).toBe(2);
    expect(snapshot.currentMissedStreakStartSlot).toBe(41);
    expect(snapshot.lastObservedSlot).toBe(42);
    expect(snapshot.lastAttestedSlot).toBe(40);
    expect(snapshot.lastMissedAttestationSlot).toBe(42);
    expect(snapshot.rewardsProcessedThroughSlot).toBe(88);
    expect(snapshot.missedConsensusRewardsTotal).toBe(BigInt(15));
    expect(snapshot.missedSyncRewardsTotal).toBe(BigInt(5));
    expect(snapshot.missedAttestationsRewardsTotal).toBe(BigInt(10));
    expect(processorState.lastProcessedSlot).toBe(9001);
  });

  // This scenario proves stale indexed data aborts early and preserves the
  // validator-owned streak facts.
  it('aborts without mutating validator streak facts when indexed committee data is stale', async () => {
    // Seed the validator row and enough missed duties that a fresh run would update it.
    await seedSnapshotValidator(101);
    await seedCommitteeMisses([120, 121, 122, 123], 101);

    // Simulate the chain head moving too far beyond the indexed committee slot.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(130);

    // Run the updater with a freshness allowance that the indexed slot fails.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 123,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });

    // Confirm the worker left the streak facts and reward cursors untouched.
    const row = await getSnapshot(101);
    expect(row.consecutiveMissedAttestations).toBe(0);
    expect(row.currentMissedStreakStartSlot).toBeNull();
    expect(row.lastObservedSlot).toBe(90);
    expect(row.lastAttestedSlot).toBe(90);
    expect(row.lastMissedAttestationSlot).toBeNull();
    expect(row.rewardsProcessedThroughSlot).toBe(80);
    expect(row.missedConsensusRewardsTotal).toBe(BigInt(15));
  });

  // This scenario proves a fresh all-missed run creates one contiguous streak
  // without touching reward progress fields.
  it('tracks a contiguous all-missed streak from fresh committee duties', async () => {
    // Seed the validator row and four new missed duties inside the safe window.
    await seedSnapshotValidator(101);
    await seedCommitteeMisses([120, 121, 122, 123], 101);

    // Keep the head close enough to pass the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(129);

    // Run the updater over the fresh committee window.
    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 124,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });

    // Confirm the worker recorded only the objective streak facts.
    const row = await getSnapshot(101);
    expect(row.consecutiveMissedAttestations).toBe(4);
    expect(row.currentMissedStreakStartSlot).toBe(120);
    expect(row.lastObservedSlot).toBe(123);
    expect(row.lastAttestedSlot).toBe(90);
    expect(row.lastMissedAttestationSlot).toBe(123);
    expect(row.rewardsProcessedThroughSlot).toBe(80);
    expect(row.missedConsensusRewardsTotal).toBe(BigInt(15));
  });

  // This scenario proves an attested duty resets the streak and starts a new
  // one on the next missed duty.
  it('resets the streak after an attested duty and starts a new streak on the next miss', async () => {
    // Seed the validator row and a mixed duty sequence: miss, attest, miss, miss.
    await seedSnapshotValidator(101);
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES
        (120, 0, 101, 0, ${null}),
        (121, 1, 101, 1, ${1}),
        (122, 2, 101, 2, ${null}),
        (123, 3, 101, 3, ${null})
    `;

    // Keep the indexed window fresh so the worker processes the new duties.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(129);

    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 124,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 1,
    });

    // Only the two trailing misses after the attestation should remain in the streak.
    const row = await getSnapshot(101);
    expect(row.consecutiveMissedAttestations).toBe(2);
    expect(row.currentMissedStreakStartSlot).toBe(122);
    expect(row.lastObservedSlot).toBe(123);
    expect(row.lastAttestedSlot).toBe(121);
    expect(row.lastMissedAttestationSlot).toBe(123);
  });
});
