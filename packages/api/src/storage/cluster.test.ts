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
  // Verifies the API-key summary keeps inactive and blocked users out of active metrics.
  it('groups active, blocked, inactive, Telegram, anonymous, and Lido user metrics', async () => {
    // This case verifies the compact cluster summary used by the API key endpoint.
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'cluster-a',
        name: 'Telegram cluster',
        ownerId: 'user-tg-active',
        createdAt: new Date('2026-04-22T10:00:00.000Z'),
        lidoOperatorId: null,
        owner: { username: 'alice', telegramId: 123n, hasBlockedBot: false },
        validators: [
          { validatorIndex: 1, validator: { effectiveBalance: 32_000_000_000n } },
          { validatorIndex: 2, validator: { effectiveBalance: 31_500_000_000n } },
        ],
        _count: { validators: 2 },
      },
      {
        id: 'cluster-b',
        name: 'Telegram Lido cluster',
        ownerId: 'user-tg-active',
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        lidoOperatorId: '42',
        owner: { username: 'alice', telegramId: 123n, hasBlockedBot: false },
        validators: [{ validatorIndex: 3, validator: { effectiveBalance: 32_000_000_000n } }],
        _count: { validators: 1 },
      },
      {
        id: 'cluster-c',
        name: 'Anonymous cluster',
        ownerId: 'user-anon-active',
        createdAt: new Date('2026-04-20T10:00:00.000Z'),
        lidoOperatorId: null,
        owner: { username: 'anon:session-c', telegramId: null, hasBlockedBot: false },
        validators: [
          { validatorIndex: 3, validator: { effectiveBalance: 32_000_000_000n } },
          { validatorIndex: 4, validator: { effectiveBalance: 30_000_000_000n } },
        ],
        _count: { validators: 2 },
      },
      {
        id: 'cluster-d',
        name: 'Blocked Telegram cluster',
        ownerId: 'user-tg-blocked',
        createdAt: new Date('2026-04-19T10:00:00.000Z'),
        lidoOperatorId: null,
        owner: { username: 'blocked', telegramId: 456n, hasBlockedBot: true },
        validators: [{ validatorIndex: 5, validator: { effectiveBalance: 31_000_000_000n } }],
        _count: { validators: 1 },
      },
      {
        id: 'cluster-e',
        name: 'Empty Telegram cluster',
        ownerId: 'user-tg-inactive',
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        lidoOperatorId: null,
        owner: { username: 'idle', telegramId: 789n, hasBlockedBot: false },
        validators: [],
        _count: { validators: 0 },
      },
    ]);
    const userFindMany = vi.fn().mockResolvedValue([
      // This Telegram user has active validator-loaded clusters and should count as active.
      { id: 'user-tg-active', telegramId: 123n },
      // This anonymous user has an active validator-loaded cluster and should count as active.
      { id: 'user-anon-active', telegramId: null },
      // This Telegram user has validators but blocked the bot, so active metrics must exclude it.
      { id: 'user-tg-blocked', telegramId: 456n },
      // This Telegram user has only an empty cluster and should count as inactive.
      { id: 'user-tg-inactive', telegramId: 789n },
      // This anonymous user has no clusters and should count as inactive.
      { id: 'user-anon-inactive', telegramId: null },
    ]);

    // Provides only the Prisma delegate used by the method under test.
    const storage = new ClusterStorage({
      cluster: { findMany },
      user: { findMany: userFindMany },
    } as never);

    // Gets the cross-user cluster summary from the mocked Prisma delegates.
    const summary = await storage.getSummary();

    // Confirms the summary reports all clusters returned by storage.
    expect(summary.totalClusters).toBe(5);
    // Confirms active users exclude blocked Telegram users and users without loaded validators.
    expect(summary.activeUsers).toEqual({
      total: 2,
      totalUniqueValidators: 4,
      totalEffectiveBalance: 157_500_000_000n,
      details: {
        telegram: {
          total: 1,
          totalUniqueValidators: 3,
          totalEffectiveBalance: 95_500_000_000n,
        },
        lido: {
          total: 1,
          totalUniqueValidators: 1,
          totalEffectiveBalance: 32_000_000_000n,
        },
        annon: {
          total: 1,
          totalUniqueValidators: 2,
          totalEffectiveBalance: 62_000_000_000n,
        },
      },
    });
    // Confirms blocked Telegram users are reported separately from active users.
    expect(summary.tgBlockedUsers).toEqual({
      total: 1,
      totalUniqueValidators: 1,
      totalEffectiveBalance: 31_000_000_000n,
    });
    // Confirms users with no validator-loaded clusters are counted by auth mode only.
    expect(summary.inactiveUsers).toEqual({
      total: 2,
      annon: 1,
      tg: 1,
    });
    // Confirms each cluster includes the validator membership count.
    expect(summary.clusters).toEqual([
      {
        id: 'cluster-a',
        name: 'Telegram cluster',
        ownerId: 'user-tg-active',
        ownerUsername: 'alice',
        validatorCount: 2,
        effectiveBalance: 63_500_000_000n,
      },
      {
        id: 'cluster-b',
        name: 'Telegram Lido cluster',
        ownerId: 'user-tg-active',
        ownerUsername: 'alice',
        validatorCount: 1,
        effectiveBalance: 32_000_000_000n,
      },
      {
        id: 'cluster-c',
        name: 'Anonymous cluster',
        ownerId: 'user-anon-active',
        ownerUsername: 'annon',
        validatorCount: 2,
        effectiveBalance: 62_000_000_000n,
      },
      {
        id: 'cluster-d',
        name: 'Blocked Telegram cluster',
        ownerId: 'user-tg-blocked',
        ownerUsername: 'blocked',
        validatorCount: 1,
        effectiveBalance: 31_000_000_000n,
      },
      {
        id: 'cluster-e',
        name: 'Empty Telegram cluster',
        ownerId: 'user-tg-inactive',
        ownerUsername: 'idle',
        validatorCount: 0,
        effectiveBalance: 0n,
      },
    ]);
    // Confirms Prisma loads the user and validator data required for summary categorization.
    expect(findMany).toHaveBeenCalledWith({
      include: {
        owner: { select: { username: true, telegramId: true, hasBlockedBot: true } },
        validators: {
          select: {
            validatorIndex: true,
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
    // Confirms inactive users are computed from all user IDs and auth modes.
    expect(userFindMany).toHaveBeenCalledWith({
      select: { id: true, telegramId: true },
    });
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
