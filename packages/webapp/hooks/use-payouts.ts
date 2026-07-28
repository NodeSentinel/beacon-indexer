'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface PayoutEvent {
  slot: number;
  index: string;
  validatorIndex: number;
  amount: string;
  timestamp: number;
}

export interface PayoutsResult {
  payouts: PayoutEvent[];
  hasNextPage: boolean;
  page: number;
}

/**
 * Fetches paginated completed payouts for the selected cluster.
 */
export function usePayouts(clusterId: string | null, page: number) {
  return useQuery({
    queryKey: ['payouts', clusterId, page],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster provided');

      const response = await orpcClient.payouts({
        clusterId,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch payouts');
      }

      return response.data as PayoutsResult;
    },
    enabled: Boolean(clusterId),
  });
}
