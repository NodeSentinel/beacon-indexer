'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface BlockProposal {
  slot: number;
  blockNumber: number | null;
  validatorIndex: number;
  timestamp: number;
  consensusReward: string | null;
  executionReward: string | null;
}

export interface BlockProposalsResult {
  blocks: BlockProposal[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export function useBlockProposals(
  params: { clusterId?: string; validatorIndex?: number } | null,
  page: number = 1,
) {
  const hasFilter = params && (params.clusterId || params.validatorIndex !== undefined);

  return useQuery({
    queryKey: ['blockProposals', params?.clusterId, params?.validatorIndex, page],
    queryFn: async () => {
      if (!params) throw new Error('No filter provided');

      const response = await orpcClient.blocks.list({
        clusterId: params.clusterId,
        validatorIndex: params.validatorIndex,
        page,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch block proposals');
      }

      return response.data as BlockProposalsResult;
    },
    enabled: !!hasFilter,
  });
}
