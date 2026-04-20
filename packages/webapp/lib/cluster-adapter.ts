import type { Cluster, ClusterValidator } from '@/types/cluster';

// Beacon API status codes to UI status mapping
const BEACON_STATUS_MAP: Record<
  number,
  'pending' | 'active' | 'active_exiting' | 'slashed' | 'exited' | 'inactive'
> = {
  0: 'pending', // pending_initialized
  1: 'pending', // pending_queued
  2: 'active', // active_ongoing
  3: 'active_exiting', // active_exiting
  4: 'slashed', // active_slashed
  5: 'exited', // exited_unslashed
  6: 'slashed', // exited_slashed
  7: 'exited', // withdrawal_possible
  8: 'exited', // withdrawal_done
};

/**
 * Transforms an API cluster list response into the UI Cluster[] format (basic info for tabs).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toClusterList(apiClusters: any[]): Cluster[] {
  return apiClusters.map((c) => ({
    id: c.id,
    name: c.name,
    visibility: c.visibility,
    ownerId: c.ownerId,
    withdrawalAddresses: [],
    feeRecipientAddress: c.feeRecipientAddress,
    validatorIndices: [],
    validators: [],
    validatorCount: c.validatorCount,
    totalBalance: 0,
    totalEffectiveBalance: 0,
    claimableRewards: 0,
    performance: 0,
    createdAt: c.createdAt,
  }));
}

/**
 * Transforms a detailed API cluster response into the UI Cluster format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toDetailedCluster(clusterDetail: any): Cluster {
  return {
    id: clusterDetail.id,
    name: clusterDetail.name,
    visibility: clusterDetail.visibility,
    ownerId: clusterDetail.ownerId,
    withdrawalAddresses: clusterDetail.withdrawalAddresses,
    feeRecipientAddress: clusterDetail.feeRecipientAddress,
    validatorIndices: clusterDetail.validators.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: any) => v.validatorIndex,
    ),
    validators: clusterDetail.validators.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: any): ClusterValidator => {
        const beaconStatus =
          v.status !== null ? BEACON_STATUS_MAP[v.status] || 'inactive' : 'inactive';
        // Override active beacon status with inactive when the monitor detects the validator is down
        const status = v.isInactive && beaconStatus === 'active' ? 'inactive' : beaconStatus;
        return {
          id: v.validatorIndex.toString(),
          index: v.validatorIndex,
          pubkey: v.pubkey || '',
          status,
          balance: parseFloat(v.balance),
          effectiveBalance: v.effectiveBalance ? parseFloat(v.effectiveBalance) : 0,
          performance: v.performanceH !== null ? v.performanceH * 100 : 0,
          clusterId: clusterDetail.id,
        };
      },
    ),
    validatorCount: clusterDetail.validators.length,
    totalBalance: parseFloat(clusterDetail.totalBalance),
    totalEffectiveBalance: parseFloat(clusterDetail.totalEffectiveBalance),
    claimableRewards: 0, // TODO: calculate from withdrawal data
    performance: 0,
    createdAt: clusterDetail.createdAt,
  };
}
