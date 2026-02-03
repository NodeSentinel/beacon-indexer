'use client';

import { useMutation } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ValidatorSearchResult {
  index: number;
  pubkey: string | null;
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
 * Hook to search validators by withdrawal address
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
