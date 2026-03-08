'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import { useUserId } from '@/lib/user-id';
import type { RewardsResponse } from '@/types/validator';

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
        response = await orpcClient.cluster.allRewards({ ownerId: userId, range });
      } else if (clusterId !== null) {
        response = await orpcClient.cluster.rewards({ id: clusterId, range });
      } else {
        return { items: [], tokenPrice: 0 };
      }

      if (!response.success) {
        throw new Error('Failed to fetch rewards');
      }

      return response.data as RewardsResponse;
    },
    enabled: (!!clusterId && (clusterId !== 'all' || !!userId)) || validatorIndex !== null,
    refetchInterval: 30_000,
  });
}
