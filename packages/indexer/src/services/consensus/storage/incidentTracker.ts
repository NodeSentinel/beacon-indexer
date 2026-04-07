import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { IncidentStorage } from './incident.js';

const INCIDENT_TRACKED_BEACON_STATUSES = [
  VALIDATOR_STATUS.pending_initialized,
  VALIDATOR_STATUS.pending_queued,
  VALIDATOR_STATUS.active_ongoing,
  VALIDATOR_STATUS.active_exiting,
  VALIDATOR_STATUS.active_slashed,
] as const;

type DutyRow = {
  slot: number;
  validator_index: number;
  attestation_delay: number | null;
};

type ValidatorState = {
  streakCount: number;
  streakStartSlot: number | null;
  inactive: boolean;
  inactiveSinceSlot: number | null;
};

type ClusterState = {
  inactiveValidators: Set<number>;
  inactiveSinceByValidator: Map<number, number>;
  openIncident: { id: string } | null;
};

export class IncidentTrackerStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly incidentStorage: IncidentStorage,
  ) {}

  async processSlotsThrough(params: {
    processor: string;
    safeUpperBound: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
  }): Promise<void> {
    const { processor, safeUpperBound, maxAttestationDelay, inactiveMissedCount } = params;

    await this.prisma.$transaction(async (tx) => {
      const state = await tx.incidentProcessorState.upsert({
        where: { processor },
        update: {},
        create: { processor, lastProcessedSlot: -1 },
      });

      const fromSlot = state.lastProcessedSlot + 1;
      if (fromSlot > safeUpperBound) {
        return;
      }

      await this.syncIncidentsForSlotRange(tx, {
        fromSlot,
        toSlot: safeUpperBound,
        maxAttestationDelay,
        inactiveMissedCount,
      });

      await tx.incidentProcessorState.update({
        where: { processor },
        data: { lastProcessedSlot: safeUpperBound },
      });
    });
  }

  private isMissedDuty(duty: DutyRow, maxAttestationDelay: number): boolean {
    return duty.attestation_delay === null || duty.attestation_delay > maxAttestationDelay;
  }

  private async syncIncidentsForSlotRange(
    tx: Prisma.TransactionClient,
    params: {
      fromSlot: number;
      toSlot: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    },
  ): Promise<void> {
    const memberships = await tx.$queryRaw<Array<{ cluster_id: string; validator_index: number }>>`
      SELECT cv.cluster_id, cv.validator_index
      FROM cluster_validator cv
      JOIN validator v ON v.id = cv.validator_index
      WHERE COALESCE(v.status, 0) = ANY(${INCIDENT_TRACKED_BEACON_STATUSES}::int[])
    `;

    if (memberships.length === 0) {
      return;
    }

    const validatorToClusters = new Map<number, string[]>();
    const clusterStates = new Map<string, ClusterState>();
    for (const membership of memberships) {
      const clusters = validatorToClusters.get(membership.validator_index) ?? [];
      clusters.push(membership.cluster_id);
      validatorToClusters.set(membership.validator_index, clusters);
      if (!clusterStates.has(membership.cluster_id)) {
        clusterStates.set(membership.cluster_id, {
          inactiveValidators: new Set<number>(),
          inactiveSinceByValidator: new Map<number, number>(),
          openIncident: null,
        });
      }
    }

    const validatorIndexes = [...validatorToClusters.keys()].sort((a, b) => a - b);
    const historyStartSlot = Math.max(0, params.fromSlot - params.inactiveMissedCount * 40);
    const duties = await tx.$queryRaw<DutyRow[]>`
      SELECT c.slot, c.validator_index, c.attestation_delay
      FROM committee c
      WHERE c.validator_index = ANY(${validatorIndexes}::int[])
        AND c.slot BETWEEN ${historyStartSlot}::int AND ${params.toSlot}::int
      ORDER BY c.slot ASC, c.validator_index ASC
    `;

    const dutiesByValidator = new Map<number, DutyRow[]>();
    const dutiesBySlot = new Map<number, DutyRow[]>();
    for (const duty of duties) {
      const validatorDuties = dutiesByValidator.get(duty.validator_index) ?? [];
      validatorDuties.push(duty);
      dutiesByValidator.set(duty.validator_index, validatorDuties);

      if (duty.slot >= params.fromSlot) {
        const slotDuties = dutiesBySlot.get(duty.slot) ?? [];
        slotDuties.push(duty);
        dutiesBySlot.set(duty.slot, slotDuties);
      }
    }

    const validatorStates = new Map<number, ValidatorState>();
    for (const validatorIndex of validatorIndexes) {
      const priorDuties = (dutiesByValidator.get(validatorIndex) ?? []).filter(
        (duty) => duty.slot < params.fromSlot,
      );

      let streakCount = 0;
      let streakStartSlot: number | null = null;
      for (let index = priorDuties.length - 1; index >= 0; index -= 1) {
        const duty = priorDuties[index];
        if (!this.isMissedDuty(duty, params.maxAttestationDelay)) {
          break;
        }

        streakCount += 1;
        streakStartSlot = duty.slot;
      }

      const inactive = streakCount >= params.inactiveMissedCount;
      validatorStates.set(validatorIndex, {
        streakCount,
        streakStartSlot,
        inactive,
        inactiveSinceSlot: inactive ? streakStartSlot : null,
      });
    }

    const openIncidents = await tx.clusterIncident.findMany({
      where: { status: 'open' },
      select: { id: true, clusterId: true },
    });
    for (const incident of openIncidents) {
      const clusterState = clusterStates.get(incident.clusterId);
      if (clusterState) {
        clusterState.openIncident = { id: incident.id };
      }
    }

    for (const [validatorIndex, state] of validatorStates) {
      if (!state.inactive || state.inactiveSinceSlot === null) {
        continue;
      }

      for (const clusterId of validatorToClusters.get(validatorIndex) ?? []) {
        const clusterState = clusterStates.get(clusterId)!;
        clusterState.inactiveValidators.add(validatorIndex);
        clusterState.inactiveSinceByValidator.set(validatorIndex, state.inactiveSinceSlot);
      }
    }

    for (const [clusterId, clusterState] of clusterStates) {
      if (clusterState.openIncident || clusterState.inactiveValidators.size === 0) {
        continue;
      }

      const openedSlot = Math.min(...clusterState.inactiveSinceByValidator.values());
      const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
        clusterId,
        openedSlot,
        validatorIndexes: [...clusterState.inactiveValidators].sort((a, b) => a - b),
      });
      clusterState.openIncident = { id: incident.id };
    }

    const orderedSlots = [...dutiesBySlot.keys()].sort((a, b) => a - b);
    for (const slot of orderedSlots) {
      const additionsByCluster = new Map<
        string,
        Array<{ validatorIndex: number; inactiveSinceSlot: number }>
      >();
      const removalsByCluster = new Map<string, number[]>();

      for (const duty of dutiesBySlot.get(slot) ?? []) {
        const state = validatorStates.get(duty.validator_index)!;
        const wasInactive = state.inactive;

        if (this.isMissedDuty(duty, params.maxAttestationDelay)) {
          if (state.streakCount === 0) {
            state.streakStartSlot = duty.slot;
          }
          state.streakCount += 1;
        } else {
          state.streakCount = 0;
          state.streakStartSlot = null;
        }

        state.inactive = state.streakCount >= params.inactiveMissedCount;
        state.inactiveSinceSlot = state.inactive ? state.streakStartSlot : null;

        if (!wasInactive && state.inactive && state.inactiveSinceSlot !== null) {
          for (const clusterId of validatorToClusters.get(duty.validator_index) ?? []) {
            const additions = additionsByCluster.get(clusterId) ?? [];
            additions.push({
              validatorIndex: duty.validator_index,
              inactiveSinceSlot: state.inactiveSinceSlot,
            });
            additionsByCluster.set(clusterId, additions);
          }
        }

        if (wasInactive && !state.inactive) {
          for (const clusterId of validatorToClusters.get(duty.validator_index) ?? []) {
            const removals = removalsByCluster.get(clusterId) ?? [];
            removals.push(duty.validator_index);
            removalsByCluster.set(clusterId, removals);
          }
        }
      }

      const affectedClusters = new Set([...additionsByCluster.keys(), ...removalsByCluster.keys()]);

      for (const clusterId of affectedClusters) {
        const clusterState = clusterStates.get(clusterId)!;

        for (const validatorIndex of removalsByCluster.get(clusterId) ?? []) {
          clusterState.inactiveValidators.delete(validatorIndex);
          clusterState.inactiveSinceByValidator.delete(validatorIndex);
        }

        for (const addition of additionsByCluster.get(clusterId) ?? []) {
          clusterState.inactiveValidators.add(addition.validatorIndex);
          clusterState.inactiveSinceByValidator.set(
            addition.validatorIndex,
            addition.inactiveSinceSlot,
          );
        }

        if (clusterState.inactiveValidators.size === 0) {
          if (clusterState.openIncident) {
            await this.incidentStorage.closeIncident(tx, {
              incidentId: clusterState.openIncident.id,
              closedSlot: slot,
            });
            clusterState.openIncident = null;
          }
          continue;
        }

        const openedSlot = Math.min(...clusterState.inactiveSinceByValidator.values());
        const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
          clusterId,
          openedSlot,
          validatorIndexes: [...clusterState.inactiveValidators].sort((a, b) => a - b),
        });
        clusterState.openIncident = { id: incident.id };
      }
    }
  }
}
