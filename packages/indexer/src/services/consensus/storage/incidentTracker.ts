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

    // Keep a durable processor cursor so each run advances from the last finished
    // slot instead of reconstructing cluster incidents from genesis every time.
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

      // Replay only the slot range that became newly safe since the previous run.
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
    // Load current open incidents first so their validators stay in scope even if
    // they have no new duties in the slot window being processed right now.
    const openIncidents = await tx.clusterIncident.findMany({
      where: { status: 'open' },
      select: { id: true, clusterId: true, validatorIndexes: true },
    });

    // Limit all downstream work to validators that either have relevant duties in
    // the historical window or are already part of an open incident.
    const historyStartSlot = Math.max(0, params.fromSlot - params.inactiveMissedCount * 40);
    const validatorsWithRelevantDuties = await tx.$queryRaw<Array<{ validator_index: number }>>`
      SELECT DISTINCT c.validator_index
      FROM committee c
      WHERE c.slot BETWEEN ${historyStartSlot}::int AND ${params.toSlot}::int
    `;
    const relevantValidatorIndexes = [
      ...new Set([
        ...validatorsWithRelevantDuties.map((row) => row.validator_index),
        ...openIncidents.flatMap((incident) => incident.validatorIndexes),
      ]),
    ];

    if (relevantValidatorIndexes.length === 0 && openIncidents.length === 0) {
      return;
    }

    // Load only memberships for validators that can actually affect incident state
    // in this run, instead of scanning the full cluster-validator relation table.
    const memberships =
      relevantValidatorIndexes.length > 0
        ? await tx.$queryRaw<Array<{ cluster_id: string; validator_index: number }>>`
            SELECT cv.cluster_id, cv.validator_index
            FROM cluster_validator cv
            JOIN validator v ON v.id = cv.validator_index
            WHERE cv.validator_index = ANY(${relevantValidatorIndexes}::int[])
              AND COALESCE(v.status, 0) = ANY(${INCIDENT_TRACKED_BEACON_STATUSES}::int[])
          `
        : [];

    if (memberships.length === 0 && openIncidents.length === 0) {
      return;
    }

    // Build the per-validator and per-cluster in-memory state that the slot replay
    // mutates as it walks through the confirmed duty sequence.
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

    // Preserve knowledge of already-open incidents so clusters without current
    // memberships can still be closed cleanly when they empty out.
    for (const incident of openIncidents) {
      if (!clusterStates.has(incident.clusterId)) {
        clusterStates.set(incident.clusterId, {
          inactiveValidators: new Set<number>(),
          inactiveSinceByValidator: new Map<number, number>(),
          openIncident: { id: incident.id },
        });
      } else {
        clusterStates.get(incident.clusterId)!.openIncident = { id: incident.id };
      }
    }

    const validatorIndexes = [...validatorToClusters.keys()].sort((a, b) => a - b);
    // Fetch the complete duty history required to reconstruct each validator's
    // starting streak at `fromSlot`, plus the duties that will be replayed forward.
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

    // Split duties by validator for initial streak reconstruction and by slot for
    // the forward replay that opens/closes incidents in chronological order.
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

    // Reconstruct each validator's state immediately before `fromSlot` so the
    // forward replay starts from the same durable state the chain would have had.
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

    // Seed cluster state with validators that were already inactive when the
    // replay window starts, so existing incidents remain consistent.
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

    // Reconcile any cluster that was already open at the start boundary before we
    // begin replaying newer slots one by one.
    for (const [clusterId, clusterState] of clusterStates) {
      if (clusterState.openIncident && clusterState.inactiveValidators.size === 0) {
        await this.incidentStorage.closeIncident(tx, {
          incidentId: clusterState.openIncident.id,
          closedSlot: params.fromSlot,
        });
        clusterState.openIncident = null;
      }

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

    // Replay the slot range in order so incident openings, additions, removals,
    // and closures follow the exact chronology of the indexed duties.
    const orderedSlots = [...dutiesBySlot.keys()].sort((a, b) => a - b);
    for (const slot of orderedSlots) {
      const additionsByCluster = new Map<
        string,
        Array<{ validatorIndex: number; inactiveSinceSlot: number }>
      >();
      const removalsByCluster = new Map<string, number[]>();

      // First compute all validator transitions that happened on this slot before
      // mutating cluster state, so each cluster sees a coherent slot-level delta.
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

      // Then apply the accumulated additions/removals to each affected cluster and
      // reconcile the incident row that should exist after this slot.
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
          if (clusterState.openIncident !== null) {
            await this.incidentStorage.closeIncident(tx, {
              incidentId: clusterState.openIncident.id,
              closedSlot: slot,
            });
            clusterState.openIncident = null;
          }
          continue;
        }

        if (clusterState.openIncident === null) {
          const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
            clusterId,
            openedSlot: Math.min(...clusterState.inactiveSinceByValidator.values()),
            validatorIndexes: [...clusterState.inactiveValidators].sort((a, b) => a - b),
          });
          clusterState.openIncident = { id: incident.id };
          continue;
        }

        const hasNewAdditions = (additionsByCluster.get(clusterId) ?? []).length > 0;
        if (hasNewAdditions) {
          const incident = await this.incidentStorage.openIncidentIfMissing(tx, {
            clusterId,
            openedSlot: Math.min(...clusterState.inactiveSinceByValidator.values()),
            validatorIndexes: [...clusterState.inactiveValidators].sort((a, b) => a - b),
          });
          clusterState.openIncident = { id: incident.id };
        }
      }
    }
  }
}
