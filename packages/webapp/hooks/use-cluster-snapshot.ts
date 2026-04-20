'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ClusterSnapshot {
  activeCount: number;
  inactiveCount: number;
  statusBreakdown: Record<string, number>;
  totalBalance: string;
  totalEffectiveBalance: string;
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
  executionReward1h: { wei: string; token: string } | null;
  executionReward1d: { wei: string; token: string } | null;
  executionReward1w: { wei: string; token: string } | null;
  executionReward1m: { wei: string; token: string } | null;
  attestationEfficiency1d: number | null;
  attestationEfficiency1w: number | null;
  attestationEfficiency1m: number | null;
  avgAttestationDelay1d: number | null;
  avgAttestationDelay1w: number | null;
  avgAttestationDelay1m: number | null;
  tokenPrice: number;
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
      const d = response.data!;
      return {
        activeCount: d.activeCount,
        inactiveCount: d.inactiveCount,
        statusBreakdown: d.statusBreakdown,
        totalBalance: d.totalBalance,
        totalEffectiveBalance: d.totalEffectiveBalance,
        performance1h: d.performanceH,
        performance1d: d.performanceD,
        performance1w: d.performanceW,
        performance1m: d.performanceM,
        apy1h: d.apyH,
        apy1d: d.apyD,
        apy1w: d.apyW,
        apy1m: d.apyM,
        consensusReward1h: d.consensusRewardH,
        consensusReward1d: d.consensusRewardD,
        consensusReward1w: d.consensusRewardW,
        consensusReward1m: d.consensusRewardM,
        missedReward1h: d.missedRewardH,
        missedReward1d: d.missedRewardD,
        missedReward1w: d.missedRewardW,
        missedReward1m: d.missedRewardM,
        executionReward1h: d.executionRewardH,
        executionReward1d: d.executionRewardD,
        executionReward1w: d.executionRewardW,
        executionReward1m: d.executionRewardM,
        attestationEfficiency1d: d.attestationEfficiencyD,
        attestationEfficiency1w: d.attestationEfficiencyW,
        attestationEfficiency1m: d.attestationEfficiencyM,
        avgAttestationDelay1d: d.avgAttestationDelayD,
        avgAttestationDelay1w: d.avgAttestationDelayW,
        avgAttestationDelay1m: d.avgAttestationDelayM,
        tokenPrice: d.tokenPrice,
      } satisfies ClusterSnapshot;
    },
    enabled: !!clusterId,
    refetchInterval: 30_000,
  });
}
