export type Blockscout_Miner = {
  ens_domain_name: string | null;
  hash: string; // miner address
  implementations: unknown[];
  is_contract: boolean;
  is_verified: boolean;
  metadata: unknown | null;
  name: string | null;
  private_tags: unknown[];
  proxy_type: string | null;
  public_tags: unknown[];
  watchlist_names: unknown[];
};

export type Blockscout_Reward = {
  reward: string; // reward in wei
  type: string; // check for "Miner Reward"
};

export type Blockscout_Blocks = {
  base_fee_per_gas: string;
  blob_gas_price: string | null;
  blob_gas_used: string;
  blob_tx_count: number;
  burnt_blob_fees: string;
  burnt_fees: string;
  burnt_fees_percentage: number | null;
  difficulty: string;
  excess_blob_gas: string;
  gas_limit: string;
  gas_target_percentage: number;
  gas_used: string;
  gas_used_percentage: number;
  hash: string;
  height: number;
  miner: Blockscout_Miner;
  nonce: string;
  parent_hash: string;
  priority_fee: number;
  rewards: Blockscout_Reward[];
  size: number;
  timestamp: string;
  total_difficulty: string;
  tx_count: number;
  tx_fees: string;
  type: string;
  uncles_hashes: string[];
  withdrawals_count: number;
};

export type Etherscan_BlockReward = {
  status: string;
  message: string;
  result: {
    blockNumber: string;
    timeStamp: string;
    blockMiner: string;
    blockReward: string;
    uncles: string[];
    uncleInclusionReward: string;
  };
};
