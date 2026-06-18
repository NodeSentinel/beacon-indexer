'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

/** Fetches the latest chain statistics when the caller enables the query. */
export function useChainStats(enabled = true) {
  return useQuery({
    queryKey: ['chainStats'],
    queryFn: async () => {
      const response = await orpcClient.chain.stats();
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch chain stats');
      }
      return response.data;
    },
    enabled,
    refetchInterval: 30_000,
  });
}
