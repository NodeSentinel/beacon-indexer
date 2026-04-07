import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidatorActivityStatusStorage } from '../storage/validatorActivityStatus.js';

import { ValidatorActivityStatusController } from './validatorActivityStatus.js';

// These tests lock the controller contract for freshness gating and safe slot calculation.
describe('ValidatorActivityStatusController', () => {
  const beaconTime = new BeaconTime({
    genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
    slotDurationMs: gnosisConfig.beacon.slotDuration,
    slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
    epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
    lookbackSlot: 0,
    delaySlotsToHead: gnosisConfig.beacon.delaySlotsToHead,
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts without side effects when indexed committee data is stale', async () => {
    // The storage sync is our only side effect, so the stale path must never call it.
    const syncCurrentActivityStatus = vi.fn().mockResolvedValue(undefined);
    const controller = new ValidatorActivityStatusController(
      { syncCurrentActivityStatus } as unknown as ValidatorActivityStatusStorage,
      beaconTime,
    );

    // Make the indexed slot older than the configured freshness allowance.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(200);

    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 193,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 3,
      inactiveMissedCount: 4,
    });

    expect(syncCurrentActivityStatus).not.toHaveBeenCalled();
  });

  it('delegates fresh indexed data with a safe observed slot', async () => {
    // A fresh index should reach storage using the bounded slot that is safe to judge.
    const syncCurrentActivityStatus = vi.fn().mockResolvedValue(undefined);
    const controller = new ValidatorActivityStatusController(
      { syncCurrentActivityStatus } as unknown as ValidatorActivityStatusStorage,
      beaconTime,
    );

    // Keep the head close enough to the indexed slot to pass the freshness gate.
    vi.spyOn(beaconTime, 'getChainCurrentSlot').mockReturnValue(200);

    await controller.syncCurrentActivityStatus({
      lastIndexedSlot: 198,
      maxIndexerLagSlotsForAlerts: 6,
      maxAttestationDelay: 3,
      inactiveMissedCount: 4,
    });

    expect(syncCurrentActivityStatus).toHaveBeenCalledWith({
      safeObservedSlot: 195,
      inactiveMissedCount: 4,
      maxAttestationDelay: 3,
    });
  });
});
