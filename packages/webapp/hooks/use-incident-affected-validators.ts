'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface IncidentAffectedValidator {
  validatorIndex: number;
  inactiveFromSlot: number;
  inactiveToSlot: number | null;
  rewardsProcessedThroughSlot: number | null;
  missedAttestationRewards: string;
  missedSyncRewards: string;
  missedConsensusRewards: string;
}

export interface IncidentAffectedValidatorsResult {
  validators: IncidentAffectedValidator[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const AFFECTED_VALIDATORS_PAGE_SIZE = 100;

/** Fetches affected validators only after an incident row is expanded. */
export function useIncidentAffectedValidators(incidentId: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['incidentAffectedValidators', incidentId, page],
    queryFn: async () => {
      const response = await orpcClient.cluster.incidentAffectedValidators({
        incidentId,
        page,
        pageSize: AFFECTED_VALIDATORS_PAGE_SIZE,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch affected validators');
      }

      return response.data as IncidentAffectedValidatorsResult;
    },
    enabled,
  });
}
