'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';
import { useUserId } from '@/lib/user-id';
import type { MissedAttestation } from '@/types/validator';

export function useMissedAttestations(
  clusterId: string | null,
  validatorIndex: number | null,
  range: '1h' | '24h' = '1h',
) {
  const userId = useUserId();

  return useQuery({
    queryKey: ['missedAttestations', clusterId, validatorIndex, range, userId],
    queryFn: async (): Promise<MissedAttestation[]> => {
      let response;

      if (validatorIndex !== null) {
        response = await orpcClient.validator.missedAttestations({ index: validatorIndex, range });
      } else if (clusterId === 'all') {
        response = await orpcClient.cluster.allMissedAttestations({ range });
      } else if (clusterId !== null) {
        response = await orpcClient.cluster.missedAttestations({ id: clusterId, range });
      } else {
        return [];
      }

      if (!response.success) {
        throw new Error('Failed to fetch missed attestations');
      }

      return response.data as MissedAttestation[];
    },
    enabled: (!!clusterId && (clusterId !== 'all' || !!userId)) || validatorIndex !== null,
    refetchInterval: 30_000,
  });
}
