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

  it('opens a new incident when a cluster becomes inactive', async () => {
    const storage = {
      listCurrentClusterStates: vi.fn().mockResolvedValue([
        {
          cluster_id: 'cluster-1',
          cluster_name: 'Main cluster',
          owner_id: 'user-1',
          inactive_validator_indexes: [11],
        },
      ]),
      listOpenIncidents: vi.fn().mockResolvedValue([]),
      createIncident: vi.fn().mockResolvedValue({ id: 'incident-1' }),
    } as unknown as IncidentStorage;

    const controller = new IncidentController(storage, beaconTime);
    const observedSlot = 200;
    const nowSlot =
      observedSlot + gnosisConfig.beacon.delaySlotsToHead + gnosisConfig.beacon.maxAttestationDelay;

    vi.spyOn(Date, 'now').mockReturnValue(beaconTime.getTimestampFromSlotNumber(nowSlot));

    const result = await controller.syncOpenIncidents(gnosisConfig.beacon.maxAttestationDelay);

    expect(result).toEqual({ opened: 1, updated: 0, closed: 0 });
    expect((storage as any).createIncident).toHaveBeenCalledWith({
      clusterId: 'cluster-1',
      ownerId: 'user-1',
      clusterName: 'Main cluster',
      openedAt: new Date(beaconTime.getTimestampFromSlotNumber(observedSlot)),
      openedSlot: observedSlot,
      validatorIndexes: [11],
    });
  });

  it('updates and closes an existing incident from snapshot state transitions', async () => {
    const updateIncidentValidators = vi.fn().mockResolvedValue(undefined);
    const computeIncidentSummary = vi.fn().mockResolvedValue({
      missedAttestations: 4,
      missedConsensusRewards: BigInt(1234),
    });
    const closeIncident = vi.fn().mockResolvedValue(undefined);

    const storage = {
      listCurrentClusterStates: vi
        .fn()
        .mockResolvedValueOnce([
          {
            cluster_id: 'cluster-1',
            cluster_name: 'Main cluster',
            owner_id: 'user-1',
            inactive_validator_indexes: [11, 22],
          },
        ])
        .mockResolvedValueOnce([
          {
            cluster_id: 'cluster-1',
            cluster_name: 'Main cluster',
            owner_id: 'user-1',
            inactive_validator_indexes: [],
          },
        ]),
      listOpenIncidents: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'incident-1',
            cluster_id: 'cluster-1',
            opened_at: new Date(beaconTime.getTimestampFromSlotNumber(200)),
            opened_slot: 200,
            opened_validator_indexes: [11],
            current_validator_indexes: [11],
            affected_validator_indexes: [11],
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'incident-1',
            cluster_id: 'cluster-1',
            opened_at: new Date(beaconTime.getTimestampFromSlotNumber(200)),
            opened_slot: 200,
            opened_validator_indexes: [11],
            current_validator_indexes: [11, 22],
            affected_validator_indexes: [11, 22],
          },
        ]),
      updateIncidentValidators,
      computeIncidentSummary,
      closeIncident,
    } as unknown as IncidentStorage;

    const controller = new IncidentController(storage, beaconTime);

    const updateObservedSlot = 210;
    vi.spyOn(Date, 'now').mockReturnValue(
      beaconTime.getTimestampFromSlotNumber(
        updateObservedSlot +
          gnosisConfig.beacon.delaySlotsToHead +
          gnosisConfig.beacon.maxAttestationDelay,
      ),
    );

    const updateResult = await controller.syncOpenIncidents(
      gnosisConfig.beacon.maxAttestationDelay,
    );

    expect(updateResult).toEqual({ opened: 0, updated: 1, closed: 0 });
    expect(updateIncidentValidators).toHaveBeenCalledWith({
      incidentId: 'incident-1',
      currentValidatorIndexes: [11, 22],
      affectedValidatorIndexes: [11, 22],
    });

    const closeObservedSlot = 220;
    vi.spyOn(Date, 'now').mockReturnValue(
      beaconTime.getTimestampFromSlotNumber(
        closeObservedSlot +
          gnosisConfig.beacon.delaySlotsToHead +
          gnosisConfig.beacon.maxAttestationDelay,
      ),
    );

    const closeResult = await controller.syncOpenIncidents(gnosisConfig.beacon.maxAttestationDelay);

    expect(closeResult).toEqual({ opened: 0, updated: 0, closed: 1 });
    expect(computeIncidentSummary).toHaveBeenCalledWith({
      fromSlot: 200,
      toSlot: 220,
      fromEpoch: beaconTime.getEpochFromSlot(200),
      toEpoch: beaconTime.getEpochFromSlot(220),
      validatorIndexes: [11, 22],
      maxAttestationDelay: gnosisConfig.beacon.maxAttestationDelay,
    });
    expect(closeIncident).toHaveBeenCalledWith({
      incidentId: 'incident-1',
      ownerId: 'user-1',
      clusterId: 'cluster-1',
      clusterName: 'Main cluster',
      closedAt: new Date(beaconTime.getTimestampFromSlotNumber(closeObservedSlot)),
      closedSlot: closeObservedSlot,
      durationSlots: 20,
      durationSeconds: Math.floor(
        (beaconTime.getTimestampFromSlotNumber(closeObservedSlot) -
          beaconTime.getTimestampFromSlotNumber(200)) /
          1000,
      ),
      missedAttestations: 4,
      missedConsensusRewards: BigInt(1234),
      affectedValidatorIndexes: [11, 22],
    });
  });
});
