'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ClusterSnapshot {
  activeCount: number;
  inactiveCount: number;
  statusBreakdown: Record<string, number>;
  totalBalance: string;
  totalEffectiveBalance: string;
  attestationsTotal: number;
  attestationsMissed: number;
  performance1h: number | null;
  performance1d: number | null;
  performance1w: number | null;
  performance1m: number | null;
  apy1h: number | null;
  apy1d: number | null;
  apy1w: number | null;
  apy1m: number | null;
  consensusReward1h: string | null;
  consensusReward1d: string | null;
  consensusReward1w: string | null;
  consensusReward1m: string | null;
  missedReward1h: string | null;
  missedReward1d: string | null;
  missedReward1w: string | null;
  missedReward1m: string | null;
  executionReward1h: string | null;
  executionReward1d: string | null;
  executionReward1w: string | null;
  executionReward1m: string | null;
}

export function useClusterSnapshot(clusterId: string | null) {
  return useQuery({
    queryKey: ['clusterSnapshot', clusterId],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster ID');
      const response = await orpcClient.cluster.snapshot({ id: clusterId });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch cluster snapshot');
      }
      return response.data as ClusterSnapshot;
    },
    enabled: !!clusterId,
  });
}
