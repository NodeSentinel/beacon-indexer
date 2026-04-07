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
 * validator's balances, rewards, metrics, and activity state.
 *
 * Two concerns are tested here:
 *   1. Balance and metrics refreshes — copying live validator data into the
 *      snapshot without changing liveness fields.
 *   2. New validator detection — finding validators that joined a cluster but
 *      don't have a snapshot row yet, and inserting one.
 *
 * ---
 *
 * Key config (Gnosis):
 *   slotsPerEpoch:                   16
 *   maxAttestationDelay:              5   (slots a valid attestation can be delayed)
 */

// ---------------------------------------------------------------------------
// Balance and Metrics Updates
// ---------------------------------------------------------------------------

describe('Snapshot - Balance and Metrics Updates', () => {
  let prisma: PrismaClient;
  let snapshotStorage: SnapshotStorage;
  let snapshotController: SnapshotController;
  let beaconTime: BeaconTime;

  const LOOKBACK_SLOT = 0;
  const MAX_ATTESTATION_DELAY = gnosisConfig.beacon.maxAttestationDelay; // 5
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
    // Drop any existing partitions and create a single one covering the real
    // slot range we need for live hourly metrics.
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'committee'::regclass LOOP EXECUTE 'DROP TABLE ' || r.child || ' CASCADE'; END LOOP; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS committee_test_partition PARTITION OF committee FOR VALUES FROM (0) TO (100000000)`,
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
   * Sets the snapshot row to a non-default activity state so we can verify
   * balance and metrics updates do not rewrite liveness fields.
   */
  async function seedActivityState(validatorIndex: number) {
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats
      SET
        status = 'inactive',
        is_inactive = true,
        inactive_since_slot = 100,
        active_since_slot = NULL
      WHERE validator_index = ${validatorIndex}
    `;
  }

  /**
   * Inserts a committee row for hourly metrics checks.
   *
   * @param delay - Slot delay (1 = included next slot). null = never included (missed).
   */
  async function insertCommitteeRow(
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
   * Reads the snapshot row for a single validator.
   */
  async function getSnapshot(validatorIndex: number) {
    const rows = await prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: string;
        is_inactive: boolean;
        inactive_since_slot: number | null;
        active_since_slot: number | null;
        balance: bigint;
        effective_balance: bigint;
        beacon_status: number | null;
        attestation_count_h: number;
        missed_attestation_count_h: number;
        performance_h: string | null;
        apy_h: string | null;
        consensus_reward_h: bigint | null;
      }>
    >`SELECT * FROM validators_snapshot_stats WHERE validator_index = ${validatorIndex}`;
    return rows[0] ?? null;
  }

  // -- Tests -----------------------------------------------------------------

  it('should update balances without changing activity fields', async () => {
    // Create one validator and the base snapshot row that the worker updates.
    await setupValidatorsInCluster([1]);

    // Seed the snapshot with a non-default activity state to ensure it survives
    // the balance refresh.
    await seedActivityState(1);

    // Change the validator row so the balance refresh has something real to copy.
    await prisma.validator.update({
      where: { id: 1 },
      data: {
        status: 7,
        balance: BigInt(32_123_000_000),
        effectiveBalance: BigInt(31_999_000_000),
      },
    });

    // Only balances are refreshed here; activity fields should remain untouched.
    await snapshotController.updateBalances();

    // Verify the snapshot copied the validator balances and status.
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.balance).toBe(BigInt(32_123_000_000));
    expect(row!.effective_balance).toBe(BigInt(31_999_000_000));
    expect(row!.beacon_status).toBe(7);
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);
    expect(row!.inactive_since_slot).toBe(100);
    expect(row!.active_since_slot).toBeNull();
  });

  it('should update hourly metrics without changing activity fields', async () => {
    // Create one validator and its snapshot row.
    await setupValidatorsInCluster([1]);

    // Seed activity fields so we can prove the metrics refresh does not rewrite them.
    await seedActivityState(1);

    // Use near-head slots so the hourly metrics query includes them.
    const currentSlot = beaconTime.getChainCurrentSlot();
    const slotA = currentSlot - 20;
    const slotB = currentSlot - 19;

    // Insert one on-time attestation and one missed attestation.
    await insertCommitteeRow(1, slotA, 1, 0, 0);
    await insertCommitteeRow(1, slotB, null, 1, 0);

    // Refresh hourly metrics from the live committee data.
    await snapshotController.updatePerformanceH(MAX_ATTESTATION_DELAY);

    // Confirm the hourly metrics were updated while activity state stayed intact.
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(row!.attestation_count_h).toBe(2);
    expect(row!.missed_attestation_count_h).toBe(1);
    expect(Number(row!.performance_h)).toBeCloseTo(0.5, 2);
    expect(row!.status).toBe('inactive');
    expect(row!.is_inactive).toBe(true);
    expect(row!.inactive_since_slot).toBe(100);
    expect(row!.active_since_slot).toBeNull();
  });

  it('should preserve performance columns when balances refresh', async () => {
    // This guards the snapshot worker contract: balances are updated in place
    // without disturbing fields populated by metrics jobs.
    await setupValidatorsInCluster([1]);

    // Pre-seed performance fields with known values.
    await prisma.$executeRaw`
      UPDATE validators_snapshot_stats
      SET performance_h = 0.9500, apy_h = 3.50, consensus_reward_h = 1000000
      WHERE validator_index = 1
    `;

    // Change the validator row so balance refresh has new values to copy.
    await prisma.validator.update({
      where: { id: 1 },
      data: {
        status: 11,
        balance: BigInt(32_555_000_000),
        effectiveBalance: BigInt(32_444_000_000),
      },
    });

    // Run the balance refresh on its own.
    await snapshotController.updateBalances();

    // Performance columns should still have the original values.
    const row = await getSnapshot(1);
    expect(row).not.toBeNull();
    expect(Number(row!.performance_h)).toBeCloseTo(0.95, 2);
    expect(Number(row!.apy_h)).toBeCloseTo(3.5, 1);
    expect(row!.consensus_reward_h).toBe(BigInt(1000000));
    expect(row!.balance).toBe(BigInt(32_555_000_000));
    expect(row!.effective_balance).toBe(BigInt(32_444_000_000));
    expect(row!.beacon_status).toBe(11);
    expect(row!.status).toBe('active');
    expect(row!.is_inactive).toBe(false);
    expect(row!.inactive_since_slot).toBeNull();
    expect(row!.active_since_slot).toBeNull();
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
