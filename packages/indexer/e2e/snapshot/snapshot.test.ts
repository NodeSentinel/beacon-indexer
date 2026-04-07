import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { PrismaClient } from '@beacon-indexer/db';
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { SnapshotStorage } from '@/src/services/consensus/storage/snapshot.js';

/**
 * E2E tests for the snapshot system.
 *
 * The snapshot table (`validators_snapshot_stats`) holds a live summary of each
 * validator's attestation stats, activity status, and performance metrics.
 *
 * Two concerns are tested here:
 *   1. Inactivity detection — deciding if a validator is "active" or "inactive"
 *      based on recent attestations.
 *   2. New validator detection — finding validators that joined a cluster but
 *      don't have a snapshot row yet, and inserting one.
 *
 * ---
 *
 * Key config (Gnosis):
 *   slotsPerEpoch:                   16
 *   maxAttestationDelay:              5   (slots a valid attestation can be delayed)
 *   delaySlotsToHead:                 3   (safety margin for chain head)
 *   missedAttestationsForInactivity:  3   (consecutive misses to mark inactive)
 *
 * Key concept — "maxSlotToQuery":
 *   We can only judge an attestation as "missed" once its full delay window has
 *   passed. So we never evaluate slots too close to the chain head.
 *
 *     maxSlotToQuery = currentSlot - delaySlotsToHead - maxAttestationDelay
 *
 *   Example: currentSlot=200 → maxSlotToQuery = 200 - 3 - 5 = 192
 *   Attestations at slots > 192 are ignored — they might still arrive.
 *
 * Key concept — "missed attestation":
 *   An attestation is missed when:
 *     - attestation_delay IS NULL (never arrived), OR
 *     - attestation_delay > maxAttestationDelay (arrived too late)
 *   Otherwise it counts as on-time.
 */

// ---------------------------------------------------------------------------
// Inactivity Detection
// ---------------------------------------------------------------------------

describe('Snapshot - Inactivity Detection', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;
  let snapshotController: SnapshotController;
  let beaconTime: BeaconTime;

  // Gnosis chain parameters used across all tests
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
    // Fresh BeaconTime instance per test
    beaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: SLOTS_PER_EPOCH,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      lookbackSlot: LOOKBACK_SLOT,
    });

    snapshotStorage = new SnapshotStorage(prisma);
    snapshotController = new SnapshotController(snapshotStorage, beaconTime);

    // Wipe all tables (order matters — foreign keys)
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster_validator"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "validator"`);

    // The `committee` table is range-partitioned by slot.
    // Drop any existing partitions and create a single one covering slots 0–9999
    // so test inserts (slot 100, 110, etc.) have somewhere to land.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (10000)`,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // -- Helpers ---------------------------------------------------------------

  /**
   * Creates the full hierarchy needed for a validator to appear in the snapshot:
   *   user → cluster → cluster_validator → validator → snapshot row
   */
  async function setupValidatorsInCluster(validatorIds: number[]) {
    // One user owns one cluster
    await prisma.user.create({
      data: { id: 'test-user-1', username: 'test-user' },
    });
    const cluster = await prisma.cluster.create({
      data: { name: 'test', ownerId: 'test-user-1', visibility: 'private' },
    });

    // Register each validator and link it to the cluster
    for (const id of validatorIds) {
      await prisma.validator.upsert({
        where: { id },
        create: {
          id,
          status: 2, // active_ongoing
          balance: BigInt(32_000_000_000), // 32 GNO
          effectiveBalance: BigInt(32_000_000_000),
        },
        update: {},
      });
      await prisma.clusterValidator.create({
        data: { clusterId: cluster.id, validatorIndex: id },
      });
    }

    // Create the snapshot base rows (all performance fields start as NULL)
    await snapshotStorage.insertNewValidatorSnapshots(validatorIds);
  }

  /**
   * Inserts a single attestation into the committee table.
   *
   * @param delay - Slot delay (1 = included next slot). null = never included (missed).
   */
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

  /**
   * Runs the snapshot update with explicit slot boundaries.
   * We call the storage directly (not the controller) so tests control exactly
   * which slot window is evaluated — no dependency on wall clock.
   */
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

  /** Reads the snapshot row for a single validator. */
  async function getSnapshot(validatorIndex: number) {
    const rows = await prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: string;
        is_inactive: boolean;
        inactive_since_slot: number | null;
        active_since_slot: number | null;
        attestations_total: number;
        attestations_missed: number;
      }>
    >`SELECT * FROM validators_snapshot_stats WHERE validator_index = ${validatorIndex}`;
    return rows[0] ?? null;
  }

  // -- Tests -----------------------------------------------------------------

  it('should mark validator as active when attesting on-time', async () => {
    // Setup: one validator in a cluster
    await setupValidatorsInCluster([1]);

    // Validator 1 attests at 3 slots, all with delay <= maxAttestationDelay (on-time)
    await insertAttestation(1, 100, 1, 0, 0); // delay=1 → on-time
    await insertAttestation(1, 110, 2, 1, 0); // delay=2 → on-time
    await insertAttestation(1, 120, 3, 2, 0); // delay=3 → on-time

    // Evaluate slots 50–130, inactivity window starts at slot 90
    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // All 3 attestations were on-time → active, 0 missed
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_total).toBe(3);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should mark validator as inactive when missing N consecutive attestations', async () => {
    await setupValidatorsInCluster([1]);

    // Validator 1 has 3 attestations, all with delay=null (never arrived → missed)
    await insertAttestation(1, 100, null, 0, 0); // missed
    await insertAttestation(1, 110, null, 1, 0); // missed
    await insertAttestation(1, 120, null, 2, 0); // missed

    // Evaluate slots 50–130
    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // 3 consecutive misses = missedAttestationsForInactivity → inactive
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);
    expect(row!.inactive_since_slot).toBe(100);
    expect(row!.active_since_slot).toBeNull();
  });

  it('should NOT count as missed when slot is beyond maxSlotToQuery', async () => {
    await setupValidatorsInCluster([1]);

    // Slot 100: on-time attestation (within query window)
    await insertAttestation(1, 100, 1, 0, 0);
    // Slots 130, 135, 140: missed attestations, BUT beyond maxSlotToQuery=125
    // These must be ignored — they're too recent to judge.
    await insertAttestation(1, 130, null, 1, 0);
    await insertAttestation(1, 135, null, 2, 0);
    await insertAttestation(1, 140, null, 3, 0);

    // Only evaluate up to slot 125
    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 125,
      inactivityCheckStartSlot: 90,
    });

    // Only slot 100 was evaluated (on-time) → active, 1 total, 0 missed
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_total).toBe(1);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should not count attestation as missed when within delay window', async () => {
    await setupValidatorsInCluster([1]);

    // Attestation arrives with delay exactly equal to maxAttestationDelay (5).
    // delay <= maxAttestationDelay → still counts as on-time.
    await insertAttestation(1, 100, MAX_ATTESTATION_DELAY, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // delay=5 is within threshold → not missed
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.attestations_missed).toBe(0);
  });

  it('should count attestation as missed when past delay window', async () => {
    await setupValidatorsInCluster([1]);

    // Attestation arrives with delay=6, which exceeds maxAttestationDelay=5.
    // delay > maxAttestationDelay → missed.
    await insertAttestation(1, 100, MAX_ATTESTATION_DELAY + 1, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // delay=6 exceeds threshold → 1 missed
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_missed).toBe(1);
  });

  it('should recover from inactive to active when validator attests again', async () => {
    await setupValidatorsInCluster([1]);

    // Step 1: Validator misses 3 consecutive attestations → becomes inactive
    await insertAttestation(1, 100, null, 0, 0); // missed
    await insertAttestation(1, 110, null, 1, 0); // missed
    await insertAttestation(1, 120, null, 2, 0); // missed

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Confirm: validator is inactive
    let row = await getSnapshot(1);
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);

    // Step 2: Validator comes back with a successful attestation at slot 125
    await insertAttestation(1, 125, 1, 3, 0); // on-time!

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // The last 3 attestations by slot DESC: 125 (ok), 120 (missed), 110 (missed)
    // Only 2 of the last 3 are missed — that's below the threshold of 3 → active again
    row = await getSnapshot(1);
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.inactive_since_slot).toBeNull();
    expect(row!.active_since_slot).toBe(125);
  });

  it('should count null attestation_delay as missed', async () => {
    await setupValidatorsInCluster([1]);

    // Slot 100: delay=null (attestation never arrived → missed)
    await insertAttestation(1, 100, null, 0, 0);
    // Slot 110: delay=1 (on-time)
    await insertAttestation(1, 110, 1, 1, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // 2 total attestations, 1 missed (the null one)
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(2);
    expect(row!.attestations_missed).toBe(1);
  });

  it('should mark validator as inactive when all attestations have excessive delay', async () => {
    // Doc case 3: attestations arrive but with delay > maxAttestationDelay → all missed
    await setupValidatorsInCluster([1]);

    // All 3 attestations have delay=6, which exceeds maxAttestationDelay=5
    await insertAttestation(1, 100, MAX_ATTESTATION_DELAY + 1, 0, 0); // delay=6 → missed
    await insertAttestation(1, 110, MAX_ATTESTATION_DELAY + 1, 1, 0); // delay=6 → missed
    await insertAttestation(1, 120, MAX_ATTESTATION_DELAY + 1, 2, 0); // delay=6 → missed

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Even though attestations were included, they arrived too late → inactive
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);
    expect(row!.attestations_missed).toBe(3);
  });

  it('should mark validator as active when misses are non-consecutive', async () => {
    // Doc case 4: [on-time, missed, on-time] — misses are not consecutive
    await setupValidatorsInCluster([1]);

    // 3 attestations: on-time at 120, missed at 110, on-time at 100 (ordered by slot DESC)
    await insertAttestation(1, 100, 1, 0, 0); // on-time
    await insertAttestation(1, 110, null, 1, 0); // missed
    await insertAttestation(1, 120, 1, 2, 0); // on-time

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Last 3: [on-time, missed, on-time] → only 1 of 3 missed → active
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
  });

  it('should mark validator as active with 2 misses and 1 on-time', async () => {
    // Doc case 5: [missed, missed, on-time] — just below the threshold of 3
    await setupValidatorsInCluster([1]);

    // Oldest attestation is on-time, two most recent are missed
    await insertAttestation(1, 100, 1, 0, 0); // on-time
    await insertAttestation(1, 110, null, 1, 0); // missed
    await insertAttestation(1, 120, null, 2, 0); // missed

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Last 3: [missed, missed, on-time] → 2 of 3 missed → below threshold → active
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.attestations_missed).toBe(2);
  });

  it('should evaluate multiple validators independently', async () => {
    // Doc case 11: three validators in one cycle with different states
    await setupValidatorsInCluster([1, 2, 3]);

    // Validator 1: 3 on-time → active
    await insertAttestation(1, 100, 1, 0, 0);
    await insertAttestation(1, 110, 1, 1, 0);
    await insertAttestation(1, 120, 1, 2, 0);

    // Validator 2: 3 missed → inactive
    await insertAttestation(2, 101, null, 0, 1);
    await insertAttestation(2, 111, null, 1, 1);
    await insertAttestation(2, 121, null, 2, 1);

    // Validator 3: 2 missed + 1 on-time → active
    await insertAttestation(3, 102, 1, 0, 2);
    await insertAttestation(3, 112, null, 1, 2);
    await insertAttestation(3, 122, null, 2, 2);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Each validator is evaluated independently
    const row1 = await getSnapshot(1);
    expect(row1!.status).toBe('active');
    expect(row1!.is_inactive).toBe(false);

    const row2 = await getSnapshot(2);
    expect(row2!.status).toBe('inactive');
    expect(row2!.is_inactive).toBe(true);

    const row3 = await getSnapshot(3);
    expect(row3!.status).toBe('active');
    expect(row3!.is_inactive).toBe(false);
  });

  it('should include attestation at exact maxSlotToQuery boundary', async () => {
    // Doc case 14: attestation at exactly maxSlotToQuery is evaluated
    await setupValidatorsInCluster([1]);

    // Attestation at the exact boundary slot
    await insertAttestation(1, 125, 1, 0, 0); // on-time, at maxSlotToQuery

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 125,
      inactivityCheckStartSlot: 90,
    });

    // Slot 125 = maxSlotToQuery → included (BETWEEN is inclusive)
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(1);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should exclude attestation one slot after maxSlotToQuery', async () => {
    // Doc case 15: attestation at maxSlotToQuery + 1 is not evaluated
    await setupValidatorsInCluster([1]);

    // Attestation one slot beyond the boundary
    await insertAttestation(1, 126, null, 0, 0); // missed, but beyond maxSlotToQuery

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 125,
      inactivityCheckStartSlot: 90,
    });

    // Slot 126 > maxSlotToQuery=125 → excluded → 0 attestations evaluated
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(0);
    expect(row!.attestations_missed).toBe(0);
  });

  it('should UPDATE without wiping performance columns', async () => {
    // This test verifies the UPSERT strategy: updating attestation fields
    // must NOT null out performance fields that were set separately.

    await setupValidatorsInCluster([1]);

    // Manually set performance data on the snapshot row
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats
      SET performance_h = 0.9500, apy_h = 3.50, consensus_reward_h = 1000000
      WHERE validator_index = 1
    `;

    // Now run an attestation update (this only touches attestation/status columns)
    await insertAttestation(1, 100, 1, 0, 0);

    await runSnapshotUpdate({
      minSlotHour: 50,
      maxSlotToQuery: 130,
      inactivityCheckStartSlot: 90,
    });

    // Verify: attestation fields were updated, performance fields were preserved
    const rows = await prisma.$queryRaw<
      Array<{
        performance_h: string | null;
        apy_h: string | null;
        consensus_reward_h: bigint | null;
        attestations_total: number;
      }>
    >`SELECT performance_h, apy_h, consensus_reward_h, attestations_total FROM validators_snapshot_stats WHERE validator_index = 1`;

    const row = rows[0];
    expect(row).not.toBeNull();
    expect(row!.attestations_total).toBe(1); // updated by attestation update
    expect(Number(row!.performance_h)).toBeCloseTo(0.95, 2); // preserved
    expect(Number(row!.apy_h)).toBeCloseTo(3.5, 1); // preserved
    expect(row!.consensus_reward_h).toBe(BigInt(1000000)); // preserved
  });
});

// ---------------------------------------------------------------------------
// New Validator Detection
// ---------------------------------------------------------------------------

describe('Snapshot - New Validator Detection', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    snapshotStorage = new SnapshotStorage(prisma);
  });

  beforeEach(async () => {
    // Clean slate before each test
    await prisma.$executeRawUnsafe(`DELETE FROM "validators_snapshot_stats"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster_validator"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "cluster"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "validator"`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Creates validators linked to a cluster, but does NOT insert snapshot rows.
   * This simulates the state right after a user adds validators to their cluster.
   */
  async function createValidatorInCluster(validatorIds: number[]) {
    await prisma.user.create({
      data: { id: 'test-user-1', username: 'test-user' },
    });
    const cluster = await prisma.cluster.create({
      data: { name: 'test', ownerId: 'test-user-1', visibility: 'private' },
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
  }

  // -- Tests -----------------------------------------------------------------

  it('should detect validators in clusters without snapshot rows', async () => {
    // Two validators in a cluster, no snapshot rows yet
    await createValidatorInCluster([10, 20]);

    // findNewValidators should return both
    const newIndexes = await snapshotStorage.findNewValidators();
    expect(newIndexes).toHaveLength(2);
    expect(newIndexes.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('should return empty when all cluster validators have snapshot rows', async () => {
    // Two validators, both already have snapshot rows
    await createValidatorInCluster([10, 20]);
    await snapshotStorage.insertNewValidatorSnapshots([10, 20]);

    // Nothing new to detect
    const newIndexes = await snapshotStorage.findNewValidators();
    expect(newIndexes).toHaveLength(0);
  });

  it('should insert base snapshot rows for new validators', async () => {
    await createValidatorInCluster([10]);

    // Insert a base snapshot row
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    // Verify the row exists with sensible defaults
    const rows = await prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: string;
        is_inactive: boolean;
        inactive_since_slot: number | null;
        active_since_slot: number | null;
        attestations_total: number;
        attestations_missed: number;
      }>
    >`SELECT * FROM validators_snapshot_stats WHERE validator_index = 10`;

    const row = rows[0];
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active'); // starts as active
    expect(row!.is_inactive).toBe(false); // not inactive
    expect(row!.inactive_since_slot).toBeNull();
    expect(row!.active_since_slot).toBeNull();
    expect(row!.attestations_total).toBe(0); // no attestations yet
    expect(row!.attestations_missed).toBe(0); // no misses yet
  });

  it('should not overwrite existing snapshot rows on insert', async () => {
    // Insert a snapshot row and set some performance data
    await createValidatorInCluster([10]);
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    // Simulate: the h-performance update already ran and wrote data
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats SET performance_h = 0.9500 WHERE validator_index = 10
    `;

    // Try inserting again — should be a no-op (ON CONFLICT DO NOTHING)
    await snapshotStorage.insertNewValidatorSnapshots([10]);

    // Verify: performance_h was NOT overwritten back to NULL
    const rows = await prisma.$queryRaw<Array<{ performance_h: string | null }>>`
      SELECT performance_h FROM validators_snapshot_stats WHERE validator_index = 10
    `;
    expect(Number(rows[0]!.performance_h)).toBeCloseTo(0.95, 2);
  });
});
