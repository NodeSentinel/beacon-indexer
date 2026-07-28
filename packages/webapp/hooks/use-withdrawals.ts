'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface WithdrawalEvent {
  slot: number;
  requestIndex: number;
  type: 'partial' | 'full_exit';
  validatorIndex: number;
  pubkey: string;
  sourceAddress: string | null;
  amount: string;
  timestamp: number;
}

export interface WithdrawalsResult {
  withdrawals: WithdrawalEvent[];
  hasNextPage: boolean;
  page: number;
}

/**
 * Fetches paginated operator withdrawal requests for the selected cluster.
 */
export function useWithdrawals(clusterId: string | null, page: number) {
  return useQuery({
    queryKey: ['withdrawals', clusterId, page],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster provided');

      const response = await orpcClient.withdrawals({
        clusterId,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch withdrawals');
      }

      return response.data as WithdrawalsResult;
    },
    enabled: Boolean(clusterId),
  });
}
