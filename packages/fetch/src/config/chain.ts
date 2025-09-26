// Chain-specific configuration
// This file contains static configuration values that differ between Ethereum and Gnosis chains

export interface ChainConfig {
  // Blockchain Configuration
  blockchain: {
    chainId: number;
    scDepositAddress?: string;
  };

  // Beacon Chain Configuration (static values only)
  beacon: {
    genesisTimestamp: number;
    slotDurationInSeconds: number;
    slotsPerEpoch: number;
    epochsPerSyncCommitteePeriod: number;
    maxAttestationDelay: number;
    delaySlotsToHead: number;
    apiRequestPerSecond: number;
  };
}

// Ethereum Mainnet Configuration
export const ethereumConfig: ChainConfig = {
  blockchain: {
    chainId: 1,
  },
  beacon: {
    genesisTimestamp: 1606824000,
    slotDurationInSeconds: 12,
    slotsPerEpoch: 32,
    epochsPerSyncCommitteePeriod: 256,
    maxAttestationDelay: 2,
    delaySlotsToHead: 2,
    apiRequestPerSecond: 10,
  },
};

// Gnosis Chain Configuration
export const gnosisConfig: ChainConfig = {
  blockchain: {
    chainId: 100,
    scDepositAddress: '0x0B98057eA310F4d31F2a452B414647007d1645d9',
  },
  beacon: {
    genesisTimestamp: 1638993340,
    slotDurationInSeconds: 12,
    slotsPerEpoch: 32,
    epochsPerSyncCommitteePeriod: 256,
    maxAttestationDelay: 2,
    delaySlotsToHead: 2,
    apiRequestPerSecond: 10,
  },
};

// Chain configuration selector
export function getChainConfig(chain: 'ethereum' | 'gnosis'): ChainConfig {
  switch (chain) {
    case 'ethereum':
      return ethereumConfig;
    case 'gnosis':
      return gnosisConfig;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}
