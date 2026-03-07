'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import { useUserId } from '@/lib/user-id';

/**
 * Hook to fetch all clusters for the current user
 */
export function useClusters() {
  const userId = useUserId();

  return useQuery({
    queryKey: ['clusters', userId],
    queryFn: async () => {
      const response = await orpcClient.cluster.list({ ownerId: userId });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch clusters');
      }
      return response.data;
    },
    enabled: !!userId,
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
  });
}

/**
 * Hook to create a new cluster
 */
export function useCreateCluster() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      validatorIndexes: number[];
      visibility?: 'private' | 'shared';
      feeRecipientAddress?: string | null;
    }) => {
      const response = await orpcClient.cluster.create({
        ...data,
        visibility: data.visibility || 'private',
        ownerId: userId,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to create cluster');
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
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
    }) => {
      const { id, ...updateData } = data;
      const response = await orpcClient.cluster.update({ id, ...updateData });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update cluster');
      }
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
      queryClient.invalidateQueries({ queryKey: ['cluster', variables.id] });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
      queryClient.invalidateQueries({ queryKey: ['cluster', variables.clusterId] });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] });
      queryClient.invalidateQueries({ queryKey: ['cluster', variables.clusterId] });
    },
  });
}
