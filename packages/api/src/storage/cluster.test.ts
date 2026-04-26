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
  it('returns total cluster count and validator count per cluster', async () => {
    // This case verifies the compact cluster summary used by the API key endpoint.
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        createdAt: new Date('2026-04-22T10:00:00.000Z'),
        owner: { username: 'alice', telegramId: 123n },
        _count: { validators: 3 },
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        owner: { username: 'anon:session-b', telegramId: null },
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
    // Confirms each cluster includes the validator membership count.
    expect(summary.clusters).toEqual([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        ownerUsername: 'alice',
        validatorCount: 3,
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        ownerUsername: 'annon',
        validatorCount: 2,
      },
    ]);
    // Confirms Prisma counts validators without loading validator rows.
    expect(findMany).toHaveBeenCalledWith({
      include: {
        owner: { select: { username: true, telegramId: true } },
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

describe('ClusterStorage query performance safeguards', () => {
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
