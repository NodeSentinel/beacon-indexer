import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

// Keeps this storage-unit test independent from the API runtime environment.
vi.mock('@/lib/prisma.js', () => ({
  getPrisma: vi.fn(),
}));

import { ClusterStorage } from './cluster.js';

const schemaUrl = new URL('../../../db/prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../../../db/prisma/migrations/20251210144216_initial/migration.sql',
  import.meta.url,
);

describe('ClusterStorage.getSummary', () => {
  it('returns total cluster count, validator count, and effective balance per cluster', async () => {
    // This case verifies the compact cluster summary used by the API key endpoint.
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        createdAt: new Date('2026-04-22T10:00:00.000Z'),
        owner: { username: 'alice', telegramId: 123n },
        validators: [
          { validator: { effectiveBalance: 32_000_000_000n } },
          { validator: { effectiveBalance: 31_500_000_000n } },
          { validator: { effectiveBalance: null } },
        ],
        _count: { validators: 3 },
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        owner: { username: 'anon:session-b', telegramId: null },
        validators: [
          { validator: { effectiveBalance: 32_000_000_000n } },
          { validator: { effectiveBalance: 32_000_000_000n } },
        ],
        _count: { validators: 2 },
      },
    ]);
    const groupBy = vi
      .fn()
      .mockResolvedValue([
        { validatorIndex: 1 },
        { validatorIndex: 2 },
        { validatorIndex: 3 },
        { validatorIndex: 4 },
      ]);
    const count = vi.fn().mockResolvedValue(2);

    // Provides only the Prisma delegate used by the method under test.
    const storage = new ClusterStorage({
      cluster: { findMany },
      clusterValidator: { groupBy },
      user: { count },
    } as never);

    // Gets the cross-user cluster summary.
    const summary = await storage.getSummary();

    // Confirms the summary reports all clusters returned by storage.
    expect(summary.totalClusters).toBe(2);
    // Confirms the summary reports the total number of users.
    expect(summary.totalUsers).toBe(2);
    // Confirms the summary counts validators once across all clusters.
    expect(summary.totalUniqueValidators).toBe(4);
    // Confirms the summary includes the raw total effective balance across clusters.
    expect(summary.totalEffectiveBalance).toBe(127_500_000_000n);
    // Confirms each cluster includes the validator membership count.
    expect(summary.clusters).toEqual([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        ownerUsername: 'alice',
        validatorCount: 3,
        effectiveBalance: 63_500_000_000n,
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        ownerUsername: 'annon',
        validatorCount: 2,
        effectiveBalance: 64_000_000_000n,
      },
    ]);
    // Confirms Prisma counts validators without loading validator rows.
    expect(findMany).toHaveBeenCalledWith({
      include: {
        owner: { select: { username: true, telegramId: true } },
        validators: {
          select: {
            validator: {
              select: {
                effectiveBalance: true,
              },
            },
          },
        },
        _count: { select: { validators: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Confirms duplicate validator memberships across clusters are counted once.
    expect(groupBy).toHaveBeenCalledWith({
      by: ['validatorIndex'],
    });
    // Confirms users are counted without loading user rows.
    expect(count).toHaveBeenCalledWith();
  });
});

describe('ClusterStorage Lido CSM operator persistence', () => {
  it('stores the required Lido operator id when creating a Lido-backed cluster', async () => {
    // This case verifies cluster creation persists the cluster-level Lido operator reference.
    const cluster = {
      id: 'cluster-a',
      name: 'Lido cluster',
      ownerId: 'user-a',
      visibility: 'private',
      feeRecipientAddress: null,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
    };
    const tx = {
      cluster: { create: vi.fn().mockResolvedValue(cluster) },
      clusterValidator: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const transaction = vi.fn((callback) => callback(tx));
    const storage = new ClusterStorage({ $transaction: transaction } as never);

    // Creates a cluster that came from a Lido CSM operator search.
    await storage.create({
      name: 'Lido cluster',
      ownerId: 'user-a',
      visibility: 'private' as never,
      validatorIndexes: [1],
      lidoCsmOperatorId: 12,
    });

    // Confirms the cluster row stores the Lido operator id as a string.
    expect(tx.cluster.create).toHaveBeenCalledWith({
      data: {
        name: 'Lido cluster',
        ownerId: 'user-a',
        visibility: 'private',
        feeRecipientAddress: undefined,
        lidoOperatorId: '12',
      },
    });
  });

  it('stores the required Lido operator id when updating a Lido-backed cluster', async () => {
    // This case verifies the update persistence path stores the operator id without a second row write.
    const cluster = {
      id: 'cluster-a',
      name: 'Lido cluster',
      ownerId: 'user-a',
      visibility: 'private',
      feeRecipientAddress: null,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
    };
    const tx = {
      cluster: { findUniqueOrThrow: vi.fn(), update: vi.fn().mockResolvedValue(cluster) },
      clusterValidator: { findMany: vi.fn() },
    };
    const transaction = vi.fn((callback) => callback(tx));
    const storage = new ClusterStorage({ $transaction: transaction } as never);

    // Saves an update that came from a concrete Lido CSM operator selection.
    await storage.updateWithValidatorsAndLidoOperator(
      'cluster-a',
      { validatorIndexes: undefined },
      12,
    );

    // Confirms the cluster record stores the Lido operator id as part of the main update.
    expect(tx.cluster.update).toHaveBeenCalledWith({
      where: { id: 'cluster-a' },
      data: {
        feeRecipientAddress: undefined,
        lidoOperatorId: '12',
        name: undefined,
        visibility: undefined,
      },
    });
    // Confirms no extra read is needed when the operator id itself requires a row update.
    expect(tx.cluster.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('does not clear the Lido operator id when deleting a cluster', async () => {
    // This case verifies cluster deletion leaves Lido cleanup to the explicit cluster action.
    const cluster = {
      id: 'cluster-a',
      ownerId: 'user-a',
    };
    const tx = {
      cluster: {
        delete: vi.fn().mockResolvedValue(cluster),
      },
      user: {
        update: vi.fn(),
      },
    };
    const storage = new ClusterStorage({ cluster: tx.cluster, user: tx.user } as never);

    // Deletes a cluster without changing the user's Lido operator setting.
    await storage.delete('cluster-a');

    // Confirms the owner Lido CSM reference is only changed by the explicit user route.
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('removes Lido validators and clears the cluster operator id in one transaction', async () => {
    // This case verifies Lido CSM cleanup cannot leave cluster membership and cluster settings split.
    const cluster = { id: 'cluster-a', lidoOperatorId: null };
    const tx = {
      clusterValidator: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      cluster: { update: vi.fn().mockResolvedValue(cluster) },
    };
    const transaction = vi.fn((callback) => callback(tx));
    const storage = new ClusterStorage({ $transaction: transaction } as never);

    // Clears Lido CSM data for one owned cluster.
    const result = await storage.clearLidoOperatorFromOwnedCluster('cluster-a', 'user-a', [1, 2]);

    // Confirms both mutations ran inside the same Prisma transaction callback.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.clusterValidator.deleteMany).toHaveBeenCalledWith({
      where: {
        cluster: { id: 'cluster-a', ownerId: 'user-a' },
        validatorIndex: { in: [1, 2] },
      },
    });
    expect(tx.cluster.update).toHaveBeenCalledWith({
      where: { id: 'cluster-a', ownerId: 'user-a' },
      data: { lidoOperatorId: null },
      select: { id: true, lidoOperatorId: true },
    });
    expect(result).toEqual({ cluster, removedValidatorCount: 2 });
  });
});

describe('ClusterStorage query performance safeguards', () => {
  it('keeps the Lido operator id in the cluster schema and migration', async () => {
    // This case verifies the cluster-level Lido CSM reference is present in schema and SQL.
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, 'utf8'),
      readFile(
        new URL(
          '../../../db/prisma/migrations/20260509120000_move_lido_operator_id_to_cluster/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    ]);

    // Confirms Prisma exposes the cluster-level Lido CSM operator reference.
    expect(schema).toContain('lidoOperatorId');
    expect(schema).toContain('@map("lido_operator_id")');
    // Confirms the migration moves the mapped database column from users to clusters.
    expect(migration).toContain(
      'ALTER TABLE "public"."cluster" ADD COLUMN "lido_operator_id" TEXT;',
    );
    expect(migration).toContain('ALTER TABLE "public"."user" DROP COLUMN "lido_operator_id";');
  });

  it('keeps the owner cluster list backed by a matching index', async () => {
    // This case verifies the hot owner-scoped cluster listing has schema and migration indexes.
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, 'utf8'),
      readFile(migrationUrl, 'utf8'),
    ]);

    // Confirms Prisma schema documents the owner/date index used by listByOwner.
    expect(schema).toContain('@@index([ownerId, createdAt(sort: Desc)])');
    // Confirms the initial migration creates the same physical Postgres index.
    expect(migration).toContain(
      'CREATE INDEX "cluster_owner_id_created_at_idx" ON "public"."cluster"("owner_id", "created_at" DESC);',
    );
  });

  it('builds cluster snapshots without rejoining membership for status breakdown', async () => {
    // This case protects the snapshot aggregation from scanning cluster membership twice.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const storage = new ClusterStorage({ $queryRaw: queryRaw } as never);

    // Executes the method so the Prisma tagged SQL is constructed through real code.
    await storage.getClusterSnapshot('cluster-a');

    // Reads the raw SQL template sent to Prisma for structural assertions.
    const sql = Array.from(queryRaw.mock.calls[0]?.[0] ?? []).join('?');

    // Confirms the joined validator snapshot set is materialized once for reuse.
    expect(sql).toContain('WITH merged_snapshot AS MATERIALIZED');
    // Confirms status breakdown reuses the merged snapshot instead of a second membership join.
    expect(sql).not.toContain('FROM cluster_validator cv2');
  });
});
