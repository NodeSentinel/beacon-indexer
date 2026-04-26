'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

const SYNC_THRESHOLD_SLOTS = 10;

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
          lastIndexedSlot: 0,
          isSynced: false,
        };
      }

      const lastIndexedSlot = Math.max(data.processingSlot - 1, 0);

      return {
        ...data,
        lastIndexedSlot,
        isSynced: data.currentSlot - lastIndexedSlot < SYNC_THRESHOLD_SLOTS,
      };
    },
    refetchInterval: 5_000,
  });
}
