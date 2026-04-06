import type { Cluster } from './cluster';

export interface Validator {
  id: string;
  index: number;
  pubkey: string;
  status: 'active' | 'inactive' | 'pending' | 'exited' | 'slashed' | 'active_exiting';
  balance: number; // in GNO
  effectiveBalance: number;
  performance: number; // percentage
  missedAttestations: number;
  clusterId: string;
}

export interface AlertConfig {
  performanceThreshold: number; // percentage below which to alert
  inactivitySlots: number; // number of slots before considering validator inactive
  rewardThreshold: number; // GNO amount to trigger reward alert
  alertFrequency: number; // minutes between repeated alerts
  alerts: {
    syncCommitteeParticipation: boolean;
    withdrawals: boolean;
    blockProposer: boolean;
  };
}

export interface Stats {
  performance1h: number;
  balance: number;
  balanceUsd: number;
  claimable: number;
  claimableUsd: number;
  apyDay: number;
  apyWeek: number;
  apyMonth: number;
  gnoDay: number;
  gnoWeek: number;
  gnoMonth: number;
  xdaiDay: number;
  xdaiWeek: number;
  xdaiMonth: number;
  missedDay: number;
  missedWeek: number;
  missedMonth: number;
  totalDay: number;
  totalWeek: number;
  totalMonth: number;
  gnoPrice: number;
  lastUpdated: string;
}

export interface MissedAttestation {
  timestamp: string;
  count: number; // number of attestations missed at this time
  validatorCount: number; // number of validators that missed
}

export interface Reward {
  timestamp: string;
  /** CL rewards in token units (GNO or ETH) */
  head: string;
  target: string;
  source: string;
  inactivity: string;
  sync: string;
  missed: string;
  blockConsensus: string;
  /** Execution reward in native EL token (xDAI or ETH) */
  blockExecution: string;
}

export interface RewardsResponse {
  items: Reward[];
  tokenPrice: number;
}

export interface ValidatorEvent {
  id: string;
  type:
    | 'deposit'
    | 'partial_withdrawal'
    | 'full_withdrawal'
    | 'inactive'
    | 'block_proposed'
    | 'sync_committee'
    | 'slashed'
    | 'attestation'
    | 'consolidation'; // Added consolidation event type
  validatorIndex: number;
  timestamp: string;
  details: string;
  amount?: number;
  blockNumber?: number;
  targetValidator?: number; // Added to track which validator it was consolidated into
}

export interface ValidatorData {
  clusters: Cluster[];
  alertConfig: AlertConfig;
  stats: Stats;
  missedAttestations: MissedAttestation[];
  events: ValidatorEvent[];
}
