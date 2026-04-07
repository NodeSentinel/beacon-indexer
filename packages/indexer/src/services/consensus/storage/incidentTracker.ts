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
};

type ClusterState = {
  threshold: number;
  qualifyingValidators: Set<number>;
  qualifyingOpenedSlotByValidator: Map<number, number>;
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
  }): Promise<void> {
    const { processor, safeUpperBound, maxAttestationDelay } = params;

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
    },
  ): Promise<void> {
    const memberships = await tx.$queryRaw<
      Array<{
        cluster_id: string;
        validator_index: number;
        missed_attestation_threshold: number;
      }>
    >`
      SELECT
        cv.cluster_id,
        cv.validator_index,
        c.missed_attestation_threshold
      FROM cluster_validator cv
      JOIN cluster c ON c.id = cv.cluster_id
      JOIN validator v ON v.id = cv.validator_index
      WHERE COALESCE(v.status, 0) = ANY(${INCIDENT_TRACKED_BEACON_STATUSES}::int[])
    `;

    const openIncidents = await tx.clusterIncident.findMany({
      where: { status: 'open' },
      include: {
        cluster: {
          select: { missedAttestationThreshold: true },
        },
      },
    });

    if (memberships.length === 0 && openIncidents.length === 0) {
      return;
    }

    const validatorToClusters = new Map<number, Array<{ clusterId: string; threshold: number }>>();
    const clusterStates = new Map<string, ClusterState>();
    let maxThreshold = 0;

    for (const membership of memberships) {
      const clusters = validatorToClusters.get(membership.validator_index) ?? [];
      clusters.push({
        clusterId: membership.cluster_id,
        threshold: membership.missed_attestation_threshold,
      });
      validatorToClusters.set(membership.validator_index, clusters);

      maxThreshold = Math.max(maxThreshold, membership.missed_attestation_threshold);

      if (!clusterStates.has(membership.cluster_id)) {
        clusterStates.set(membership.cluster_id, {
          threshold: membership.missed_attestation_threshold,
          qualifyingValidators: new Set<number>(),
          qualifyingOpenedSlotByValidator: new Map<number, number>(),
          openIncident: null,
        });
      }
    }

    for (const incident of openIncidents) {
      if (!clusterStates.has(incident.clusterId)) {
        clusterStates.set(incident.clusterId, {
          threshold: incident.cluster.missedAttestationThreshold,
          qualifyingValidators: new Set<number>(),
          qualifyingOpenedSlotByValidator: new Map<number, number>(),
          openIncident: { id: incident.id },
        });
      } else {
        clusterStates.get(incident.clusterId)!.openIncident = { id: incident.id };
      }
    }

    const validatorIndexes = [...validatorToClusters.keys()].sort((a, b) => a - b);
    const historyStartSlot = Math.max(0, params.fromSlot - Math.max(maxThreshold, 1) * 40);
    const duties =
      validatorIndexes.length > 0
        ? await tx.$queryRaw<DutyRow[]>`
            SELECT c.slot, c.validator_index, c.attestation_delay
            FROM committee c
            WHERE c.validator_index = ANY(${validatorIndexes}::int[])
              AND c.slot BETWEEN ${historyStartSlot}::int AND ${params.toSlot}::int
            ORDER BY c.slot ASC, c.validator_index ASC
          `
        : [];

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

      validatorStates.set(validatorIndex, {
        streakCount,
        streakStartSlot,
      });
    }

    for (const [validatorIndex, state] of validatorStates) {
      for (const cluster of validatorToClusters.get(validatorIndex) ?? []) {
        if (state.streakStartSlot === null || state.streakCount < cluster.threshold) {
          continue;
        }

        const clusterState = clusterStates.get(cluster.clusterId)!;
        clusterState.qualifyingValidators.add(validatorIndex);
        clusterState.qualifyingOpenedSlotByValidator.set(
          validatorIndex,
          state.streakStartSlot + cluster.threshold - 1,
        );
      }
    }

    for (const [clusterId, clusterState] of clusterStates) {
      if (clusterState.openIncident && clusterState.qualifyingValidators.size === 0) {
        await this.incidentStorage.closeIncident(tx, {
          incidentId: clusterState.openIncident.id,
          closedSlot: params.fromSlot,
        });
        clusterState.openIncident = null;
      }

      if (clusterState.openIncident || clusterState.qualifyingValidators.size === 0) {
        continue;
      }

      const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
        clusterId,
        openedSlot: Math.min(...clusterState.qualifyingOpenedSlotByValidator.values()),
        validatorIndexes: [...clusterState.qualifyingValidators].sort((a, b) => a - b),
      });
      clusterState.openIncident = { id: incident.id };
    }

    const orderedSlots = [...dutiesBySlot.keys()].sort((a, b) => a - b);
    for (const slot of orderedSlots) {
      const additionsByCluster = new Map<
        string,
        Array<{ validatorIndex: number; openedSlot: number }>
      >();
      const removalsByCluster = new Map<string, number[]>();

      for (const duty of dutiesBySlot.get(slot) ?? []) {
        const state = validatorStates.get(duty.validator_index);
        if (state === undefined) {
          continue;
        }

        const previousStreakCount = state.streakCount;
        const previousStreakStartSlot = state.streakStartSlot;

        if (this.isMissedDuty(duty, params.maxAttestationDelay)) {
          if (state.streakCount === 0) {
            state.streakStartSlot = duty.slot;
          }
          state.streakCount += 1;
        } else {
          state.streakCount = 0;
          state.streakStartSlot = null;
        }

        for (const cluster of validatorToClusters.get(duty.validator_index) ?? []) {
          const wasQualifying =
            previousStreakStartSlot !== null && previousStreakCount >= cluster.threshold;
          const isQualifying =
            state.streakStartSlot !== null && state.streakCount >= cluster.threshold;

          if (!wasQualifying && isQualifying) {
            const additions = additionsByCluster.get(cluster.clusterId) ?? [];
            additions.push({
              validatorIndex: duty.validator_index,
              openedSlot: state.streakStartSlot! + cluster.threshold - 1,
            });
            additionsByCluster.set(cluster.clusterId, additions);
          }

          if (wasQualifying && !isQualifying) {
            const removals = removalsByCluster.get(cluster.clusterId) ?? [];
            removals.push(duty.validator_index);
            removalsByCluster.set(cluster.clusterId, removals);
          }
        }
      }

      const affectedClusters = new Set([...additionsByCluster.keys(), ...removalsByCluster.keys()]);

      for (const clusterId of affectedClusters) {
        const clusterState = clusterStates.get(clusterId);
        if (clusterState === undefined) {
          continue;
        }

        for (const validatorIndex of removalsByCluster.get(clusterId) ?? []) {
          clusterState.qualifyingValidators.delete(validatorIndex);
          clusterState.qualifyingOpenedSlotByValidator.delete(validatorIndex);
        }

        for (const addition of additionsByCluster.get(clusterId) ?? []) {
          clusterState.qualifyingValidators.add(addition.validatorIndex);
          clusterState.qualifyingOpenedSlotByValidator.set(
            addition.validatorIndex,
            addition.openedSlot,
          );
        }

        if (clusterState.qualifyingValidators.size === 0) {
          if (clusterState.openIncident) {
            await this.incidentStorage.closeIncident(tx, {
              incidentId: clusterState.openIncident.id,
              closedSlot: slot,
            });
            clusterState.openIncident = null;
          }
          continue;
        }

        const hasNewAdditions = (additionsByCluster.get(clusterId) ?? []).length > 0;
        if (!clusterState.openIncident || hasNewAdditions) {
          const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
            clusterId,
            openedSlot: Math.min(...clusterState.qualifyingOpenedSlotByValidator.values()),
            validatorIndexes: [...clusterState.qualifyingValidators].sort((a, b) => a - b),
          });
          clusterState.openIncident = { id: incident.id };
        }
      }
    }
  }
}
