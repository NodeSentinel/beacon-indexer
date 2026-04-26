'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

/** Fetches sync progress and marks it synced when indexed lag is under ten slots. */
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
    select: (data) => {
      if (!data) {
        return {
          currentSlot: 0,
          processingSlot: 0,
          slotDurationMs: 0,
          isSynced: false,
        };
      }

      const lastIndexedSlot = Math.max(data.processingSlot - 1, 0);

      return {
        ...data,
        isSynced: data.currentSlot - lastIndexedSlot < 10,
      };
    },
    refetchInterval: 5_000,
  });
}
