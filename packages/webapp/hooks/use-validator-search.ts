'use client';

import { useMutation, useQueries, useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ValidatorSearchResult {
  index: number;
  pubkey: string | null;
  withdrawalAddress: string | null;
}

/**
 * Hook to search validators by index
 */
export function useSearchByIndex() {
  return useMutation({
    mutationFn: async (index: number): Promise<ValidatorSearchResult | null> => {
      const response = await orpcClient.validator.search({ index });
      if (!response.success || !response.data || response.data.validators.length === 0) {
        return null;
      }
      return response.data.validators[0];
    },
  });
}

/**
 * Hook to search validators by multiple indexes (bulk)
 */
export function useSearchByIndexes() {
  return useMutation({
    mutationFn: async (indexes: number[]): Promise<ValidatorSearchResult[]> => {
      if (indexes.length === 0) return [];
      const response = await orpcClient.validator.search({ indexes: indexes.join(',') });
      if (!response.success || !response.data) {
        throw new Error('Failed to search validators');
      }
      return response.data.validators;
    },
  });
}

/**
 * Hook to search validators by pubkey
 */
export function useSearchByPubkey() {
  return useMutation({
    mutationFn: async (pubkey: string): Promise<ValidatorSearchResult | null> => {
      const response = await orpcClient.validator.search({ pubkey });
      if (!response.success || !response.data || response.data.validators.length === 0) {
        return null;
      }
      return response.data.validators[0];
    },
  });
}

/**
 * Hook to search validators by multiple pubkeys (bulk)
 */
export function useSearchByPubkeys() {
  return useMutation({
    mutationFn: async (pubkeys: string[]): Promise<ValidatorSearchResult[]> => {
      if (pubkeys.length === 0) return [];
      const response = await orpcClient.validator.search({ pubkeys: pubkeys.join(',') });
      if (!response.success || !response.data) {
        throw new Error('Failed to search validators');
      }
      return response.data.validators;
    },
  });
}

/**
 * Hook to search validators by withdrawal address (for user-triggered searches)
 */
export function useSearchByWithdrawalAddress() {
  return useMutation({
    mutationFn: async (withdrawalAddress: string): Promise<ValidatorSearchResult[]> => {
      const response = await orpcClient.validator.search({ withdrawalAddress });
      if (!response.success || !response.data) {
        throw new Error('Failed to search validators');
      }
      return response.data.validators;
    },
  });
}

/**
 * Hook to search validators by multiple withdrawal addresses (bulk)
 */
export function useSearchByWithdrawalAddresses() {
  return useMutation({
    mutationFn: async (withdrawalAddresses: string[]): Promise<ValidatorSearchResult[]> => {
      if (withdrawalAddresses.length === 0) return [];
      const response = await orpcClient.validator.search({
        withdrawalAddresses: withdrawalAddresses.join(','),
      });
      if (!response.success || !response.data) {
        throw new Error('Failed to search validators');
      }
      return response.data.validators;
    },
  });
}

/**
 * Hook to search validators by Lido CSM operator id
 */
export function useSearchByLidoCsmOperatorId() {
  return useMutation({
    mutationFn: async (lidoCsmOperatorId: number): Promise<ValidatorSearchResult[]> => {
      const response = await orpcClient.validator.search({ lidoCsmOperatorId });
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to search Lido CSM validators');
      }
      return response.data.validators;
    },
  });
}

/**
 * Hook to fetch validators for one Lido CSM operator id in the background
 */
export function useGetValidatorsFromLidoCsmOperatorId(lidoCsmOperatorId: number | undefined) {
  const query = useQuery({
    queryKey: ['validators', 'byLidoCsmOperatorId', lidoCsmOperatorId],
    queryFn: async (): Promise<ValidatorSearchResult[]> => {
      if (lidoCsmOperatorId === undefined) {
        return [];
      }

      const response = await orpcClient.validator.search({ lidoCsmOperatorId });
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to fetch Lido CSM validators');
      }
      return response.data.validators;
    },
    enabled: lidoCsmOperatorId !== undefined,
    staleTime: 5 * 60 * 1000,
  });

  return { validators: query.data ?? [], isLoading: query.isLoading };
}

/**
 * Hook to fetch validators for multiple withdrawal addresses (for background data fetching)
 * Uses useQueries for automatic caching and deduplication
 */
export function useGetValidatorsFromWithdrawalAddresses(withdrawalAddresses: string[]) {
  const results = useQueries({
    queries: withdrawalAddresses.map((waAddress) => ({
      queryKey: ['validators', 'byWithdrawalAddress', waAddress],
      queryFn: async (): Promise<ValidatorSearchResult[]> => {
        const response = await orpcClient.validator.search({ withdrawalAddress: waAddress });
        if (!response.success || !response.data) {
          throw new Error('Failed to search validators');
        }
        return response.data.validators;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const validatorsByWithdrawalAddress: Record<string, ValidatorSearchResult[]> = {};

  for (let i = 0; i < withdrawalAddresses.length; i++) {
    const result = results[i];
    if (result.data) {
      validatorsByWithdrawalAddress[withdrawalAddresses[i]] = result.data;
    }
  }

  return { validatorsByWithdrawalAddress, isLoading };
}
