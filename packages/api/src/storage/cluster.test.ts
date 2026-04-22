import { describe, expect, it, vi } from 'vitest';

import { ClusterStorage } from './cluster.js';

describe('ClusterStorage.getSummary', () => {
  it('returns total cluster count and validator count per cluster', async () => {
    // This case verifies the compact cluster summary used by the API key endpoint.
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        createdAt: new Date('2026-04-22T10:00:00.000Z'),
        _count: { validators: 3 },
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
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

    // Provides only the Prisma delegate used by the method under test.
    const storage = new ClusterStorage({
      cluster: { findMany },
      clusterValidator: { groupBy },
    } as never);

    // Gets the cross-user cluster summary.
    const summary = await storage.getSummary();

    // Confirms the summary reports all clusters returned by storage.
    expect(summary.totalClusters).toBe(2);
    // Confirms the summary counts validators once across all clusters.
    expect(summary.totalUniqueValidators).toBe(4);
    // Confirms each cluster includes the validator membership count.
    expect(summary.clusters).toEqual([
      {
        id: 'cluster-a',
        name: 'Main cluster',
        ownerId: 'user-a',
        validatorCount: 3,
      },
      {
        id: 'cluster-b',
        name: 'Backup cluster',
        ownerId: 'user-b',
        validatorCount: 2,
      },
    ]);
    // Confirms Prisma counts validators without loading validator rows.
    expect(findMany).toHaveBeenCalledWith({
      include: { _count: { select: { validators: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Confirms duplicate validator memberships across clusters are counted once.
    expect(groupBy).toHaveBeenCalledWith({
      by: ['validatorIndex'],
    });
  });
});
