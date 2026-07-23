'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ConsolidationEvent {
  slot: number;
  requestIndex: number;
  sourceAddress: string | null;
  sourcePubkey: string;
  targetPubkey: string;
  sourceValidatorIndex: number;
  targetValidatorIndex: number | null;
  timestamp: number;
}

export interface ConsolidationsResult {
  consolidations: ConsolidationEvent[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * Fetches paginated consolidations for the selected cluster.
 */
export function useConsolidations(clusterId: string | null, page: number) {
  return useQuery({
    queryKey: ['consolidations', clusterId, page],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster provided');

      const response = await orpcClient.consolidations.list({
        clusterId,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch consolidations');
      }

      return response.data as ConsolidationsResult;
    },
    enabled: Boolean(clusterId),
  });
}
