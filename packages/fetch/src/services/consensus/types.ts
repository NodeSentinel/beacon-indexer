/**
 * Configuration for beacon URLs
 */
export type BeaconConfig = {
  primaryUrl: string;
  secondaryUrl: string;
};

/**
 * URL priority options
 */
export type UrlPriority = 'primary' | 'secondary';

/**
 * Options for endpoint requests
 */
export type EndpointOptions = {
  /**
   * URL priority to use for the request
   * @default 'primary'
   */
  priority?: UrlPriority;

  /**
   * Number of retries for the request
   * @default 0
   */
  retries?: number;
};

// TODO: analyze when to use each status to do filtering for the beacon API.
// https://docs.blockdaemon.com/docs/eth-validator-statuses
export type ValidatorStatus =
  | 'pending_initialized'
  | 'pending_queued'
  | 'active_ongoing'
  | 'active_exiting'
  | 'active_slashed'
  | 'exited_unslashed'
  | 'exited_slashed'
  | 'withdrawal_possible'
  | 'withdrawal_done';

/**
 * Ideal reward data for a specific effective balance
 */
export type IdealReward = {
  effective_balance: string;
  head: string;
  target: string;
  source: string;
  inclusion_delay?: string;
  inactivity?: string;
};

/**
 * Total reward data for a specific validator
 */
export type TotalReward = {
  validator_index: string;
  head: string;
  target: string;
  source: string;
  inclusion_delay?: string;
  inactivity?: string;
};

/**
 * Processed reward data for database storage
 */
export type ProcessedReward = {
  validatorIndex: number;
  date: string;
  hour: number;
  head: string;
  target: string;
  source: string;
  inactivity: string;
  missedHead: string;
  missedTarget: string;
  missedSource: string;
  missedInactivity: string;
};

export type GetCommittees = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    index: string;
    slot: string;
    validators: string[];
  }[];
};

export type Attestation = {
  aggregation_bits: string;
  data: {
    slot: string;
    index: string;
    beacon_block_root: string;
    source: {
      epoch: string;
      root: string;
    };
    target: {
      epoch: string;
      root: string;
    };
  };
  signature: string;
  committee_bits: string;
};

export type GetAttestations = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: Attestation[];
};

export type Block = {
  version: string;
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    message: {
      slot: string;
      proposer_index: string;
      parent_root: string;
      state_root: string;
      body: {
        randao_reveal: string;
        eth1_data: {
          deposit_root: string;
          deposit_count: string;
          block_hash: string;
        };
        graffiti: string;
        proposer_slashings: string[];
        attester_slashings: string[];
        attestations: Attestation[];
        deposits: {
          proof: string[];
          data: {
            pubkey: string;
            withdrawal_credentials: string;
            amount: string;
            signature: string;
          };
        }[];
        voluntary_exits: {
          message: {
            epoch: string;
            validator_index: string;
          };
          signature: string;
        }[];
        sync_aggregate: {
          sync_committee_bits: string;
          sync_committee_signature: string;
        };
        execution_payload: {
          parent_hash: string;
          fee_recipient: string;
          state_root: string;
          receipts_root: string;
          logs_bloom: string;
          prev_randao: string;
          block_number: string;
          gas_limit: string;
          gas_used: string;
          timestamp: string;
          extra_data: string;
          base_fee_per_gas: string;
          block_hash: string;
          transactions: string[];
          withdrawals: {
            index: string;
            validator_index: string;
            address: string;
            amount: string;
          }[];
          blob_gas_used: string;
          excess_blob_gas: string;
        };
        bls_to_execution_changes: string[];
        blob_kzg_commitments: string[];
        execution_requests?: {
          deposits: {
            pubkey: string;
            withdrawal_credentials: string;
            amount: string;
            signature: string;
            index: string;
          }[];
          withdrawals: {
            source_address: string;
            validator_pubkey: string;
            amount: string;
          }[];
          consolidations: {
            source_address: string;
            source_pubkey: string;
            target_pubkey: string;
          }[];
        };
      };
    };
  };
};

export type GetValidatorsBalances = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    index: string;
    balance: string;
  }[];
};

export type GetValidators = {
  execution_optimistic: boolean;
  data: {
    index: string;
    balance: string;
    status: ValidatorStatus;
    validator: {
      pubkey: string;
      withdrawal_credentials: string;
      effective_balance: string;
      slashed: string;
      activation_eligibility_epoch: string;
      activation_epoch: string;
      exit_epoch: string;
      withdrawable_epoch: string;
    };
  }[];
};

export type AttestationRewards = {
  execution_optimistic: boolean;
  finalized?: boolean;
  data: {
    ideal_rewards: IdealReward[];
    total_rewards: TotalReward[];
  };
};

export type ValidatorProposerDuties = {
  dependent_root: string;
  execution_optimistic: boolean;
  data: {
    pubkey: string;
    validator_index: string;
    slot: string;
  }[];
};

export type BlockRewards = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    proposer_index: string;
    total: string;
    attestations: string;
    sync_aggregate: string;
    proposer_slashings: string;
    attester_slashings: string;
  };
};

export type SyncCommitteeRewards = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    validator_index: string;
    reward: string;
  }[];
};

export type GetSyncCommittees = {
  execution_optimistic: boolean;
  finalized: boolean;
  data: {
    validators: string[];
    validator_aggregates: string[][];
  };
};
