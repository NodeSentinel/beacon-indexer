import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { IncidentStorage } from '../storage/incident.js';

import createLogger from '@/src/lib/pino.js';

type OpenIncident = {
  id: string;
  cluster_id: string;
  opened_at: Date;
  opened_slot: number;
  opened_validator_indexes: number[];
  current_validator_indexes: number[];
  affected_validator_indexes: number[];
};

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function mergeUniqueSorted(a: number[], b: number[]): number[] {
  return Array.from(new Set([...a, ...b])).sort((x, y) => x - y);
}

export class IncidentController {
  private readonly logger = createLogger('IncidentController');

  constructor(
    private readonly incidentStorage: IncidentStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  async syncOpenIncidents(maxAttestationDelay: number): Promise<{
    opened: number;
    updated: number;
    closed: number;
  }> {
    const [clusterStates, openIncidents] = await Promise.all([
      this.incidentStorage.listCurrentClusterStates(),
      this.incidentStorage.listOpenIncidents(),
    ]);

    const openByCluster = new Map(openIncidents.map((incident) => [incident.cluster_id, incident]));
    const observedSlot = Math.max(0, this.beaconTime.getChainCurrentSlot() - maxAttestationDelay);

    let opened = 0;
    let updated = 0;
    let closed = 0;

    for (const clusterState of clusterStates) {
      const incident = openByCluster.get(clusterState.cluster_id);
      const currentInactive = [...clusterState.inactive_validator_indexes].sort((a, b) => a - b);

      if (!incident && currentInactive.length > 0) {
        const openedAt = new Date(this.beaconTime.getTimestampFromSlotNumber(observedSlot));

        await this.incidentStorage.createIncident({
          clusterId: clusterState.cluster_id,
          ownerId: clusterState.owner_id,
          clusterName: clusterState.cluster_name,
          openedAt,
          openedSlot: observedSlot,
          validatorIndexes: currentInactive,
        });

        opened += 1;
        continue;
      }

      if (!incident) {
        continue;
      }

      if (currentInactive.length > 0) {
        const affectedValidatorIndexes = mergeUniqueSorted(
          incident.affected_validator_indexes,
          currentInactive,
        );

        if (
          !arraysEqual(currentInactive, incident.current_validator_indexes) ||
          !arraysEqual(affectedValidatorIndexes, incident.affected_validator_indexes)
        ) {
          await this.incidentStorage.updateIncidentValidators({
            incidentId: incident.id,
            currentValidatorIndexes: currentInactive,
            affectedValidatorIndexes,
          });
          updated += 1;
        }

        continue;
      }

      await this.closeIncident({
        clusterId: clusterState.cluster_id,
        clusterName: clusterState.cluster_name,
        incident,
        maxAttestationDelay,
        ownerId: clusterState.owner_id,
        observedSlot,
      });
      closed += 1;
    }

    if (opened || updated || closed) {
      this.logger.info('Synchronized cluster incidents', { opened, updated, closed });
    }

    return { opened, updated, closed };
  }

  private async closeIncident(params: {
    incident: OpenIncident;
    clusterId: string;
    clusterName: string;
    ownerId: string;
    observedSlot: number;
    maxAttestationDelay: number;
  }) {
    const { incident, clusterId, clusterName, ownerId, observedSlot, maxAttestationDelay } = params;
    const closedAt = new Date(this.beaconTime.getTimestampFromSlotNumber(observedSlot));
    const closedSlot = Math.max(observedSlot, incident.opened_slot);
    const durationSlots = Math.max(0, closedSlot - incident.opened_slot);
    const durationSeconds = Math.max(
      0,
      Math.floor((closedAt.getTime() - incident.opened_at.getTime()) / 1000),
    );
    const fromEpoch = this.beaconTime.getEpochFromSlot(incident.opened_slot);
    const toEpoch = this.beaconTime.getEpochFromSlot(closedSlot);

    const summary = await this.incidentStorage.computeIncidentSummary({
      fromSlot: incident.opened_slot,
      toSlot: closedSlot,
      fromEpoch,
      toEpoch,
      validatorIndexes: incident.affected_validator_indexes,
      maxAttestationDelay,
    });

    await this.incidentStorage.closeIncident({
      incidentId: incident.id,
      ownerId,
      clusterId,
      clusterName,
      closedAt,
      closedSlot,
      durationSlots,
      durationSeconds,
      missedAttestations: summary.missedAttestations,
      missedConsensusRewards: summary.missedConsensusRewards,
      affectedValidatorIndexes: incident.affected_validator_indexes,
    });
  }
}
