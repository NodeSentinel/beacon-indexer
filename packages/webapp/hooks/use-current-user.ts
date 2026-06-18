'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface CurrentUser {
  id: string;
  username: string;
}

export interface ClearLidoCsmOperatorResult {
  id: string;
  lidoOperatorId: string | null;
  removedValidatorIndexes: number[];
}

/**
 * Fetches the authenticated user resolved by the API middleware.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async (): Promise<CurrentUser> => {
      const response = await orpcClient.user.me();
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to fetch user');
      }
      return response.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Clears the current cluster's stored Lido CSM operator id.
 */
export function useClearLidoCsmOperator(clusterId?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClearLidoCsmOperatorResult> => {
      if (!clusterId) {
        throw new Error('Cluster id is required to clear Lido CSM operator id');
      }

      const response = await orpcClient.cluster.clearLidoCsmOperator({ id: clusterId });
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to clear Lido CSM operator id');
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
      queryClient.invalidateQueries({ queryKey: ['cluster'] });
      queryClient.invalidateQueries({ queryKey: ['clusterSnapshot'] });
    },
  });
}
