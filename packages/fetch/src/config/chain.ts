// Chain-specific configuration
// This file contains static configuration values that differ between Ethereum and Gnosis chains

import ms from 'ms';

export interface ChainConfig {
  // Blockchain Configuration
  blockchain: {
    chainId: number;
    scDepositAddress?: string;
  };

  // Beacon Chain Configuration (static values only)
  beacon: {
    genesisTimestamp: number;
    slotDuration: number;
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
    genesisTimestamp: ms('1606824023s'), // 1606824023
    slotDuration: ms('12s'),
    slotsPerEpoch: 32,
    epochsPerSyncCommitteePeriod: 256,
    maxAttestationDelay: 5,
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
    genesisTimestamp: ms('1638993340s'), // 1638993340
    slotDuration: ms('5s'),
    slotsPerEpoch: 16,
    epochsPerSyncCommitteePeriod: 256,
    maxAttestationDelay: 5,
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
