'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export function useSyncStatus() {
  return useQuery({
    queryKey: ['syncStatus'],
    queryFn: async () => {
      const response = await orpcClient.chain.syncStatus();
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch sync status');
      }
      return response.data;
    },
    select: (data) => ({
      ...data,
      isSynced: data ? data.processingSlot >= data.currentSlot : false,
    }),
    refetchInterval: 5_000,
  });
}
