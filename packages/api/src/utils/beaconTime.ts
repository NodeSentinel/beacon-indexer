// Re-export BeaconTime and chain config from indexer to avoid duplication
// Import from the indexer package using relative path (works in monorepo)
import { getChainConfig } from '../../../indexer/src/config/chain.js';
import { BeaconTime } from '../../../indexer/src/services/consensus/utils/beaconTime.js';

import { env } from '@/config/env.js';

// Get chain configuration
const chainConfig = getChainConfig(env.CHAIN);

// Create singleton BeaconTime instance
export const beaconTime = new BeaconTime({
  genesisTimestamp: chainConfig.beacon.genesisTimestamp,
  slotDurationMs: chainConfig.beacon.slotDuration,
  slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
  epochsPerSyncCommitteePeriod: chainConfig.beacon.epochsPerSyncCommitteePeriod,
  lookbackSlot: env.CONSENSUS_LOOKBACK_SLOT,
  delaySlotsToHead: chainConfig.beacon.delaySlotsToHead,
});

// Re-export chain config for convenience
export { chainConfig };
