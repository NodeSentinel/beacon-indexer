'use client';

import { useQuery } from '@tanstack/react-query';

import { orpcClient } from '@/lib/orpc';

export interface ClusterIncident {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedSlot: number;
  closedAt: string | null;
  closedSlot: number | null;
  durationSlots: number | null;
  durationSeconds: number | null;
  missedAttestationRewards: string | null;
  missedSyncRewards: string | null;
  missedConsensusRewards: string | null;
  rewardsFinalized: boolean;
  rewardsFinalizedAt: string | null;
  openedNotificationQueuedAt: string | null;
  closedNotificationQueuedAt: string | null;
}

export interface ClusterIncidentsResult {
  incidents: ClusterIncident[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const INCIDENTS_PAGE_SIZE = 10;

/** Fetches paginated cluster incidents when the incidents tab is active. */
export function useClusterIncidents(clusterId: string | null, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['clusterIncidents', clusterId, page],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster provided');

      const response = await orpcClient.cluster.incidents({
        id: clusterId,
        page,
        pageSize: INCIDENTS_PAGE_SIZE,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch cluster incidents');
      }

      return response.data as ClusterIncidentsResult;
    },
    enabled: Boolean(clusterId && enabled),
  });
}
