import { describe, expect, it, vi } from 'vitest';

import { IncidentRewardsStorage } from './incidentRewards.js';

describe('IncidentRewardsStorage', () => {
  it('runs synchronization inside a transaction', async () => {
    const tx = {
      clusterIncident: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    const storage = new IncidentRewardsStorage(prisma as never, {
      slotsPerEpoch: 16,
    });

    await storage.syncOpenIncidentRewards({ processThroughSlot: 100 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.clusterIncident.findMany).toHaveBeenCalledTimes(1);
  });

  it('reuses cached snapshot progress when finalizing closed incidents', async () => {
    const incident = {
      id: 'incident-1',
      clusterId: 'cluster-1',
      cluster: {
        name: 'Cluster 1',
        ownerId: 'user-1',
        owner: {
          telegramId: null,
          hasBlockedBot: false,
        },
      },
      status: 'closed',
      openedSlot: 10,
      closedSlot: 12,
      validatorIndexes: [101],
      missedConsensusRewards: BigInt(0),
      closedAt: new Date('2026-04-07T00:00:00.000Z'),
      durationSeconds: 24,
      durationSlots: 2,
    };

    const tx = {
      clusterIncident: {
        findMany: vi.fn().mockResolvedValueOnce([incident]).mockResolvedValueOnce([incident]),
        update: vi.fn().mockResolvedValue({
          ...incident,
          rewardsFinalized: true,
          rewardsFinalizedAt: new Date('2026-04-07T00:01:00.000Z'),
          closedNotificationQueuedAt: null,
        }),
      },
      validatorsSnapshotStats: {
        findMany: vi.fn().mockResolvedValue([
          {
            validatorIndex: 101,
            missedRewardsProcessedThroughSlot: 12,
          },
        ]),
        update: vi.fn(),
      },
      epochRewards: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      validatorSyncRewards: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      notificationQueue: {
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void | unknown>) =>
        callback(tx),
      ),
    };

    const storage = new IncidentRewardsStorage(prisma as never, {
      slotsPerEpoch: 16,
    });

    await storage.syncOpenIncidentRewards({ processThroughSlot: 12 });

    expect(tx.validatorsSnapshotStats.findMany).toHaveBeenCalledTimes(1);
    expect(tx.clusterIncident.update).toHaveBeenCalledTimes(1);
  });
});
