import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { SnapshotStorage } from '@/src/services/consensus/storage/snapshot.js';

/**
 * E2E tests for snapshot inactivity detection.
 *
 * Key config values (Gnosis):
 *   slotsPerEpoch: 16
 *   maxAttestationDelay: 5
 *   delaySlotsToHead: 3
 *   missedAttestationsForInactivity: 3
 *
 * Key concept: A validator assigned to attest at slot S can only be evaluated
 * as "missed" after slot S + maxAttestationDelay has been processed. Before that,
 * the attestation might still arrive with an acceptable delay.
 *
 * The maxSlotToQuery is calculated as:
 *   currentSlot - delaySlotsToHead - missedAttestationsForInactivity
 *
 * So for currentSlot=200, maxSlotToQuery = 200 - 3 - 3 = 194
 * Attestations at slots > 194 are NOT evaluated.
 */
describe('Snapshot - Inactivity Detection', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;
  let snapshotController: SnapshotController;
  let beaconTime: BeaconTime;

  const LOOKBACK_SLOT = 0;
  const MAX_ATTESTATION_DELAY = gnosisConfig.beacon.maxAttestationDelay; // 5
  const DELAY_SLOTS_TO_HEAD = gnosisConfig.beacon.delaySlotsToHead; // 3
  const MISSED_FOR_INACTIVITY = gnosisConfig.beacon.missedAttestationsForInactivity; // 3
  const SLOTS_PER_EPOCH = gnosisConfig.beacon.slotsPerEpoch; // 16

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  });

  beforeEach(async () => {
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: LOOKBACK_SLOT,
    });

    snapshotStorage = new SnapshotStorage(prisma);
    snapshotController = new SnapshotController(snapshotStorage, beaconTime);

    // Clean tables in correct order (respecting foreign keys)
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster_validator"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "validator"`);
    // committee is partitioned, truncate all partitions
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'TRUNCATE TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper: create a user, cluster, and register validators
  async function setupValidatorsInCluster(validatorIds: number[]) {
    await prisma.user.create({
      data: { id: BigInt(1), userId: BigInt(1), username: 'test-user' },
    });
    const cluster = await prisma.cluster.create({
      data: { name: 'test', ownerId: BigInt(1), visibility: 'private' },
    });
    for (const id of validatorIds) {
      await prisma.validator.upsert({
        where: { id },
        create: {
          id,
          status: 2, // active_ongoing
          balance: BigInt(32_000_000_000),
          effectiveBalance: BigInt(32_000_000_000),
        },
        update: {},
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: id },
      });
    }

    // Insert base snapshot rows for all validators
    await snapshotStorage.insertNewValidatorSnapshots(validatorIds);
  }

  // Helper: insert a committee row (attestation)
  async function insertAttestation(
    validatorIndex: number,
    slot: number,
    delay: number | null,
    index = 0,
    aggIndex = 0,
  ) {
    await prisma.$executeRaw`
      INSERT INTO committee (slot, "index", validator_index, aggregation_bits_index, attestation_delay)
      VALUES (${slot}, ${index}, ${validatorIndex}, ${aggIndex}, ${delay})
    `;
  }

  // Helper: call the storage directly with explicit slot params for test control
  async function runSnapshotUpdate(params: {
    minSlotHour: number;
    maxSlotToQuery: number;
    inactivityCheckStartSlot: number;
  }) {
    await snapshotStorage.updateAttestationsAndStatus({
      ...params,
      maxAttestationDelay: MAX_ATTESTATION_DELAY,
      inactiveMissedCount: MISSED_FOR_INACTIVITY,
    });
  }

  // Helper: read snapshot row
  async function getSnapshot(validatorIndex: number) {
    const rows = await prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: string;
        is_inactive: boolean;
        consecutive_missed_attestations: number;
        attestations_total: number;
        attestations_missed: number;
      }>
    >`SELECT * FROM validators_snapshot_stats WHERE validator_index = ${validatorIndex}`;
    return rows[0] ?? null;
  }

  it('should mark validator as active when attesting on-time', async () => {
    await setupValidatorsInCluster([1]);

    // Validator 1 attests at slots 100, 110, 120 with delay within threshold
    await insertAttestation(1, 100, 1, 0, 0);
    await insertAttestation(1, 110, 2, 1, 0);
    await insertAttestation(1, 120, 3, 2, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_total).toBe(3);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should mark validator as inactive when missing N consecutive attestations', async () => {
    await setupValidatorsInCluster([1]);

    // Validator 1 has 3 attestations all with delay=null (missed)
    await insertAttestation(1, 100, null, 0, 0);
    await insertAttestation(1, 110, null, 1, 0);
    await insertAttestation(1, 120, null, 2, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);
    expect(row!.consecutive_missed_attestations).toBeGreaterThanOrEqual(3);
  });

  it('should NOT count as missed when slot is beyond maxSlotToQuery', async () => {
    await setupValidatorsInCluster([1]);

    // Validator attests at slot 100 on-time, then has attestations at slots 130, 135, 140
    // which are BEYOND maxSlotToQuery=125 and should not be evaluated
    await insertAttestation(1, 100, 1, 0, 0);
    await insertAttestation(1, 130, null, 1, 0); // beyond maxSlotToQuery
    await insertAttestation(1, 135, null, 2, 0); // beyond maxSlotToQuery
    await insertAttestation(1, 140, null, 3, 0); // beyond maxSlotToQuery

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 125, // only evaluate up to slot 125
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    // Only slot 100 is evaluated, which was on-time
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_total).toBe(1);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should not count attestation as missed when within delay window', async () => {
    await setupValidatorsInCluster([1]);

    // Validator attests at slot 100 with delay=5 (exactly at maxAttestationDelay)
    // delay=5 means it was included 5 slots later, which is the threshold
    await insertAttestation(1, 100, MAX_ATTESTATION_DELAY, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.attestations_missed).toBe(0);
  });

  it('should count attestation as missed when past delay window', async () => {
    await setupValidatorsInCluster([1]);

    // Validator attests at slot 100 with delay=6 (exceeds maxAttestationDelay=5)
    await insertAttestation(1, 100, MAX_ATTESTATION_DELAY + 1, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_missed).toBe(1);
  });

  it('should recover from inactive to active when validator attests again', async () => {
    await setupValidatorsInCluster([1]);

    // First: 3 missed attestations -> inactive
    await insertAttestation(1, 100, null, 0, 0);
    await insertAttestation(1, 110, null, 1, 0);
    await insertAttestation(1, 120, null, 2, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    let row = await getSnapshot(1);
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);

    // Now add a successful attestation at slot 125 (within range)
    await insertAttestation(1, 125, 1, 3, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    row = await getSnapshot(1);
    // The last 3 attestations by slot DESC are: 125 (ok), 120 (missed), 110 (missed)
    // Only 2 of the last 3 are missed, so validator is active
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
  });

  it('should count null attestation_delay as missed', async () => {
    await setupValidatorsInCluster([1]);

    await insertAttestation(1, 100, null, 0, 0);
    await insertAttestation(1, 110, 1, 1, 0); // on-time

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(2);
    expect(row!.attestations_missed).toBe(1);
  });

  it('should UPDATE without wiping performance columns', async () => {
    await setupValidatorsInCluster([1]);

    // Set some performance data on the existing row
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats
      SET performance_1h = 0.9500, apy_1h = 3.50, consensus_reward_1h = 1000000
      WHERE validator_index = 1
    `;

    // Now run attestation update
    await insertAttestation(1, 100, 1, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Performance columns should be preserved
    const rows = await prisma.$queryRaw<
      Array<{
        performance_1h: string | null;
        apy_1h: string | null;
        consensus_reward_1h: bigint | null;
        attestations_total: number;
      }>
    >`SELECT performance_1h, apy_1h, consensus_reward_1h, attestations_total FROM validators_snapshot_stats WHERE validator_index = 1`;

    const row = rows[0];
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(1); // updated
    expect(Number(row!.performance_1h)).toBeCloseTo(0.95, 2); // preserved
    expect(Number(row!.apy_1h)).toBeCloseTo(3.5, 1); // preserved
    expect(row!.consensus_reward_1h).toBe(BigInt(1000000)); // preserved
  });
});

describe('Snapshot - New Validator Detection', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    snapshotStorage = new SnapshotStorage(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster_validator"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "validator"`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createValidatorInCluster(validatorIds: number[]) {
    await prisma.user.create({
      data: { id: BigInt(1), userId: BigInt(1), username: 'test-user' },
    });
    const cluster = await prisma.cluster.create({
      data: { name: 'test', ownerId: BigInt(1), visibility: 'private' },
    });
    for (const id of validatorIds) {
      await prisma.validator.upsert({
        where: { id },
        create: {
          id,
          status: 2,
          balance: BigInt(32_000_000_000),
          effectiveBalance: BigInt(32_000_000_000),
        },
        update: {},
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: id },
      });
    }
  }

  it('should detect validators in clusters without snapshot rows', async () => {
    await createValidatorInCluster([10, 20]);

    const newIndexes = await snapshotStorage.findNewValidators();
    expect(newIndexes).toHaveLength(2);
    expect(newIndexes.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('should return empty when all cluster validators have snapshot rows', async () => {
    await createValidatorInCluster([10, 20]);
    await snapshotStorage.insertNewValidatorSnapshots([10, 20]);

    const newIndexes = await snapshotStorage.findNewValidators();
    expect(newIndexes).toHaveLength(0);
  });

  it('should insert base snapshot rows for new validators', async () => {
    await createValidatorInCluster([10]);
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    const rows = await prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: string;
        is_inactive: boolean;
        attestations_total: number;
        attestations_missed: number;
      }>
    >`SELECT * FROM validators_snapshot_stats WHERE validator_index = 10`;

    const row = rows[0];
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_total).toBe(0);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should not overwrite existing snapshot rows on insert', async () => {
    await createValidatorInCluster([10]);
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    // Set performance data
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats SET performance_1h = 0.9500 WHERE validator_index = 10
    `;

    // Re-insert should be a no-op (ON CONFLICT DO NOTHING)
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    const rows = await prisma.$queryRaw<Array<{ performance_1h: string | null }>>`
      SELECT performance_1h FROM validators_snapshot_stats WHERE validator_index = 10
    `;
    expect(Number(rows[0]!.performance_1h)).toBeCloseTo(0.95, 2);
  });
});
