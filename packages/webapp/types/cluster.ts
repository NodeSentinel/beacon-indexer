export interface ClusterValidator {
  id: string;
  index: number;
  pubkey: string;
  status: 'active' | 'inactive' | 'pending' | 'exited' | 'slashed' | 'active_exiting';
  balance: number;
  effectiveBalance: number;
  performance: number;
  clusterId: string;
}

export interface Cluster {
  id: string;
  name: string;
  visibility: 'private' | 'shared';
  ownerId: string;
  withdrawalAddresses: string[];
  feeRecipientAddress: string | null;
  validatorIndices: number[];
  validators: ClusterValidator[];
  totalBalance: number;
  totalEffectiveBalance: number;
  claimableRewards: number | null;
  performance: number;
  // From API response
  validatorCount?: number;
  createdAt?: string;
}

export const CLUSTER_FILTER_ALL = 'all' as const;

export type ClusterFilter = typeof CLUSTER_FILTER_ALL | string;
