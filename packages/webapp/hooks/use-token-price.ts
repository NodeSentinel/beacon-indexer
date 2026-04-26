'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

/** Fetches the current chain token price from the dedicated price endpoint. */
export function useTokenPrice(enabled = true) {
  return useQuery({
    queryKey: ['tokenPrice'],
    queryFn: async () => {
      const response = await orpcClient.chain.tokenPrice();
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch token price');
      }
      return response.data;
    },
    enabled,
    refetchInterval: 10_000,
  });
}
