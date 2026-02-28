'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export function useChainStats() {
  return useQuery({
    queryKey: ['chain-stats'],
    queryFn: async () => {
      const response = await orpcClient.chain.stats();
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch chain stats');
      }
      return response.data;
    },
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000, // 5 minutes (~1 epoch)
  });
}
