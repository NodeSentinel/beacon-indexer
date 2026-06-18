'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import { useUserId } from '@/lib/user-id';
import type { RewardsResponse } from '@/types/validator';

type ApiRewardItem = {
  timestamp: string;
  head: string;
  target: string;
  source: string;
  inactivity: string;
  sync?: string;
  syncCommittee?: string;
  missed: string;
  blockConsensus: string;
  blockExecution: string;
};

type ApiRewardsResponse = {
  items: ApiRewardItem[];
  tokenPrice: number;
};

function normalizeRewardsResponse(data: ApiRewardsResponse): RewardsResponse {
  return {
    tokenPrice: data.tokenPrice,
    items: data.items.map((item) => ({
      timestamp: item.timestamp,
      head: item.head,
      target: item.target,
      source: item.source,
      inactivity: item.inactivity,
      sync: item.syncCommittee ?? item.sync ?? '0',
      missed: item.missed,
      blockConsensus: item.blockConsensus,
      blockExecution: item.blockExecution,
    })),
  };
}

export function useRewards(
  clusterId: string | null,
  validatorIndex: number | null,
  range: '1h' | '24h' = '1h',
) {
  const userId = useUserId();

  return useQuery({
    queryKey: ['rewards', clusterId, validatorIndex, range, userId],
    queryFn: async (): Promise<RewardsResponse> => {
      let response;

      if (validatorIndex !== null) {
        response = await orpcClient.validator.rewards({ index: validatorIndex, range });
      } else if (clusterId === 'all') {
        response = await orpcClient.cluster.allRewards({ range });
      } else if (clusterId !== null) {
        response = await orpcClient.cluster.rewards({ id: clusterId, range });
      } else {
        return { items: [], tokenPrice: 0 };
      }

      if (!response.success) {
        throw new Error('Failed to fetch rewards');
      }

      if (!response.data) {
        throw new Error('Rewards response was empty');
      }

      return normalizeRewardsResponse(response.data as unknown as ApiRewardsResponse);
    },
    enabled: (!!clusterId && (clusterId !== 'all' || !!userId)) || validatorIndex !== null,
    refetchInterval: 30_000,
  });
}
