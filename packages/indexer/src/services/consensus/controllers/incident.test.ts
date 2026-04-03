import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { gnosisConfig } from '@beacon-indexer/beacon-utils/config/chain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IncidentStorage } from '../storage/incident.js';

import { IncidentController } from './incident.js';

describe('IncidentController', () => {
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

  it('delegates incident synchronization to storage with snapshot-safe slot boundaries', async () => {
    const syncIncidents = vi.fn().mockResolvedValue(undefined);

    const storage = {
      syncIncidents,
    } as unknown as IncidentStorage;

    const controller = new IncidentController(storage, beaconTime);
    const observedSlot = 200;
    const nowSlot =
      observedSlot + gnosisConfig.beacon.delaySlotsToHead + gnosisConfig.beacon.maxAttestationDelay;

    vi.spyOn(Date, 'now').mockReturnValue(beaconTime.getTimestampFromSlotNumber(nowSlot));

    await controller.syncOpenIncidents(gnosisConfig.beacon.maxAttestationDelay);
    expect(syncIncidents).toHaveBeenCalledWith({
      observedAt: new Date(beaconTime.getTimestampFromSlotNumber(observedSlot)),
      observedAtIso: new Date(beaconTime.getTimestampFromSlotNumber(observedSlot)).toISOString(),
      observedSlot,
    });
  });
});
