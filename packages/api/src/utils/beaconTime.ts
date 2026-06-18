import { BeaconTime, getChainConfig } from '@beacon-indexer/beacon-utils';

export interface BeaconHelpers {
  beaconTime: BeaconTime;
  chainConfig: ReturnType<typeof getChainConfig>;
}

/**
 * Creates the chain configuration and BeaconTime helper from plain parameters.
 */
export function createBeaconHelpers(params: {
  chain: 'ethereum' | 'gnosis';
  lookbackSlot: number;
}): BeaconHelpers {
  const chainConfig = getChainConfig(params.chain);
  const beaconTime = new BeaconTime({
    genesisTimestamp: chainConfig.beacon.genesisTimestamp,
    slotDurationMs: chainConfig.beacon.slotDuration,
    slotsPerEpoch: chainConfig.beacon.slotsPerEpoch,
    epochsPerSyncCommitteePeriod: chainConfig.beacon.epochsPerSyncCommitteePeriod,
    lookbackSlot: params.lookbackSlot,
    delaySlotsToHead: chainConfig.beacon.delaySlotsToHead,
  });

  return {
    beaconTime,
    chainConfig,
  };
}
