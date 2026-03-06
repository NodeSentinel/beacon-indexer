'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export function useChainStats() {
  return useQuery({
    queryKey: ['chainStats'],
    queryFn: async () => {
      const response = await orpcClient.chain.stats();
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch chain stats');
      }
      return response.data;
    },
  });
}
