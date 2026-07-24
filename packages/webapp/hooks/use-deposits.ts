'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface DepositEvent {
  slot: number;
  source: 'eth1data' | 'execution_request';
  index: number;
  pubkey: string;
  withdrawalCredentials: string;
  amount: string;
  validatorIndex: number;
  timestamp: number;
}

export interface DepositsResult {
  deposits: DepositEvent[];
  hasNextPage: boolean;
  page: number;
}

/**
 * Fetches paginated deposits for the selected cluster.
 */
export function useDeposits(clusterId: string | null, page: number) {
  return useQuery({
    queryKey: ['deposits', clusterId, page],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster provided');

      const response = await orpcClient.deposits.list({
        clusterId,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch deposits');
      }

      return response.data as DepositsResult;
    },
    enabled: Boolean(clusterId),
  });
}
