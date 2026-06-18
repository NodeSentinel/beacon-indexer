'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import { useUserId } from '@/lib/user-id';

interface ClusterListItem {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  feeRecipientAddress: string | null;
  lidoOperatorId: string | null;
  ownerId: string;
  createdAt: string;
  validatorCount: number;
}

/**
 * Merges a created cluster into the cached list so the home view reflects the save immediately.
 */
function mergeCreatedCluster(
  currentClusters: ClusterListItem[] | undefined,
  createdCluster: ClusterListItem,
): ClusterListItem[] {
  const nextClusters = currentClusters?.filter((cluster) => cluster.id !== createdCluster.id) ?? [];

  // Keeps the newest cluster at the top to match the API ordering by createdAt descending.
  return [createdCluster, ...nextClusters];
}

/**
 * Normalizes the create response into the list shape used by the home cache.
 */
function toClusterListItem(
  cluster: Partial<ClusterListItem> | undefined,
  fallback: Pick<ClusterListItem, 'name' | 'visibility' | 'feeRecipientAddress' | 'validatorCount'>,
): ClusterListItem {
  if (!cluster?.id || !cluster.ownerId || !cluster.createdAt) {
    throw new Error('Failed to create cluster');
  }

  return {
    id: cluster.id,
    name: cluster.name ?? fallback.name,
    visibility: cluster.visibility ?? fallback.visibility,
    feeRecipientAddress: cluster.feeRecipientAddress ?? fallback.feeRecipientAddress,
    lidoOperatorId: cluster.lidoOperatorId ?? null,
    ownerId: cluster.ownerId,
    createdAt: cluster.createdAt,
    validatorCount: cluster.validatorCount ?? fallback.validatorCount,
  };
}

/**
 * Hook to fetch all clusters for the current user
 */
export function useClusters() {
  const userId = useUserId();

  return useQuery({
    queryKey: ['clusters'],
    queryFn: async () => {
      const response = await orpcClient.cluster.list({});
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch clusters');
      }
      return response.data;
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });
}

/**
 * Hook to fetch a single cluster by ID
 */
export function useCluster(id: string | null) {
  return useQuery({
    queryKey: ['cluster', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await orpcClient.cluster.get({ id });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch cluster');
      }
      return response.data;
    },
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

/**
 * Hook to create a new cluster
 */
export function useCreateCluster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      validatorIndexes: number[];
      visibility?: 'private' | 'shared';
      feeRecipientAddress?: string | null;
      lidoCsmOperatorId?: number;
    }): Promise<ClusterListItem> => {
      const response = await orpcClient.cluster.create({
        ...data,
        visibility: data.visibility || 'private',
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to create cluster');
      }

      return toClusterListItem(response.data, {
        name: data.name,
        visibility: data.visibility || 'private',
        feeRecipientAddress: data.feeRecipientAddress ?? null,
        validatorCount: data.validatorIndexes.length,
      });
    },
    onSuccess: (createdCluster) => {
      queryClient.setQueryData<ClusterListItem[]>(['clusters'], (currentClusters) =>
        mergeCreatedCluster(currentClusters, createdCluster),
      );
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
      queryClient.invalidateQueries({ queryKey: ['cluster'] });
      queryClient.invalidateQueries({ queryKey: ['clusterSnapshot'] });
    },
  });
}

/**
 * Hook to update a cluster
 */
export function useUpdateCluster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      name?: string;
      visibility?: 'private' | 'shared';
      feeRecipientAddress?: string | null;
      validatorIndexes?: number[];
      lidoCsmOperatorId?: number;
    }) => {
      const { id, ...updateData } = data;
      const response = await orpcClient.cluster.update({ id, ...updateData });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update cluster');
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

/**
 * Hook to delete a cluster
 */
export function useDeleteCluster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await orpcClient.cluster.delete({ id });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to delete cluster');
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

/**
 * Hook to add validators to a cluster
 */
export function useAddValidators() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { clusterId: string; validatorIndexes: number[] }) => {
      const response = await orpcClient.cluster.addValidators({
        id: data.clusterId,
        validatorIndexes: data.validatorIndexes,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to add validators');
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

/**
 * Hook to remove a validator from a cluster
 */
export function useRemoveValidator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { clusterId: string; validatorIndex: number }) => {
      const response = await orpcClient.cluster.removeValidators({
        id: data.clusterId,
        validatorIndexes: [data.validatorIndex],
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to remove validator');
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
