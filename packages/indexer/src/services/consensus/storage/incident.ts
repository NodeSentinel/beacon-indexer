import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { Prisma, PrismaClient } from '@beacon-indexer/db';

type RewardTotalsSnapshot = Record<
  string,
  {
    missedConsensusRewardsTotal: string;
    missedSyncRewardsTotal: string;
    missedAttestationsRewardsTotal: string;
  }
>;

const INCIDENT_TRACKED_BEACON_STATUSES = [
  VALIDATOR_STATUS.pending_initialized,
  VALIDATOR_STATUS.pending_queued,
  VALIDATOR_STATUS.active_ongoing,
  VALIDATOR_STATUS.active_exiting,
  VALIDATOR_STATUS.active_slashed,
] as const;

export class IncidentStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: {
      genesisTimeSec: number;
      secPerSlot: number;
      slotsPerEpoch: number;
    },
  ) {}

  private getSlotDate(slot: number): Date {
    return new Date(
      this.chainTiming.genesisTimeSec * 1000 + slot * this.chainTiming.secPerSlot * 1000,
    );
  }

  private canQueueNotification(user: {
    telegramId: bigint | null;
    hasBlockedBot: boolean;
  }): boolean {
    return user.telegramId !== null && user.hasBlockedBot === false;
  }

  private parseRewardTotalsSnapshot(value: Prisma.JsonValue | null): RewardTotalsSnapshot {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as RewardTotalsSnapshot;
  }

  private async getRewardTotalsSnapshot(
    tx: Prisma.TransactionClient,
    validatorIndexes: number[],
  ): Promise<RewardTotalsSnapshot> {
    if (validatorIndexes.length === 0) {
      return {};
    }

    const snapshots = await tx.validatorsSnapshotStats.findMany({
      where: {
        validatorIndex: { in: validatorIndexes },
      },
      select: {
        validatorIndex: true,
        missedConsensusRewardsTotal: true,
        missedSyncRewardsTotal: true,
        missedAttestationsRewardsTotal: true,
      },
    });

    return Object.fromEntries(
      snapshots.map((snapshot) => [
        String(snapshot.validatorIndex),
        {
          missedConsensusRewardsTotal: snapshot.missedConsensusRewardsTotal.toString(),
          missedSyncRewardsTotal: snapshot.missedSyncRewardsTotal.toString(),
          missedAttestationsRewardsTotal: snapshot.missedAttestationsRewardsTotal.toString(),
        },
      ]),
    );
  }

  private calculateIncidentMissedConsensusRewards(params: {
    openedTotals: RewardTotalsSnapshot;
    closedTotals: RewardTotalsSnapshot;
  }): bigint {
    const validatorIndexes = new Set([
      ...Object.keys(params.openedTotals),
      ...Object.keys(params.closedTotals),
    ]);

    let total = BigInt(0);
    for (const validatorIndex of validatorIndexes) {
      const openedTotal = BigInt(
        params.openedTotals[validatorIndex]?.missedConsensusRewardsTotal ?? '0',
      );
      const closedTotal = BigInt(
        params.closedTotals[validatorIndex]?.missedConsensusRewardsTotal ?? '0',
      );
      total += closedTotal - openedTotal;
    }

    return total;
  }

  private async queueClosedNotification(
    tx: Prisma.TransactionClient,
    incident: {
      id: string;
      clusterId: string;
      closedAt: Date | null;
      closedSlot: number | null;
      durationSeconds: number | null;
      durationSlots: number | null;
      missedConsensusRewards: bigint | null;
      cluster: {
        id: string;
        name: string;
        ownerId: string;
        owner: {
          telegramId: bigint | null;
          hasBlockedBot: boolean;
        };
      };
    },
    queuedAt: Date,
  ): Promise<void> {
    if (!this.canQueueNotification(incident.cluster.owner)) {
      return;
    }

    await tx.notificationQueue.create({
      data: {
        userId: incident.cluster.ownerId,
        type: 'incident_closed',
        payload: {
          clusterId: incident.clusterId,
          clusterName: incident.cluster.name,
          incidentId: incident.id,
          closedAt: incident.closedAt?.toISOString() ?? null,
          closedSlot: incident.closedSlot,
          durationSeconds: incident.durationSeconds,
          durationSlots: incident.durationSlots,
          missedConsensusRewards: incident.missedConsensusRewards?.toString() ?? null,
        },
        delivered: false,
        createdAt: queuedAt,
      },
    });
  }

  private async finalizeClosedIncidentIfReady(
    tx: Prisma.TransactionClient,
    incidentId: string,
    finalizedAt: Date,
  ) {
    const incident = await tx.clusterIncident.findUniqueOrThrow({
      where: { id: incidentId },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
    });

    if (
      incident.status !== 'closed' ||
      incident.closedSlot === null ||
      incident.rewardsFinalized ||
      incident.openedValidatorRewardTotals === null
    ) {
      return incident;
    }

    const snapshotRows = await tx.validatorsSnapshotStats.findMany({
      where: {
        validatorIndex: { in: incident.validatorIndexes },
      },
      select: {
        validatorIndex: true,
        rewardsProcessedThroughSlot: true,
      },
    });

    const allCaughtUp = snapshotRows.every(
      (snapshot) => (snapshot.rewardsProcessedThroughSlot ?? -1) >= incident.closedSlot!,
    );

    if (!allCaughtUp) {
      return incident;
    }

    const closedValidatorRewardTotals = await this.getRewardTotalsSnapshot(
      tx,
      incident.validatorIndexes,
    );
    const openedValidatorRewardTotals = this.parseRewardTotalsSnapshot(
      incident.openedValidatorRewardTotals,
    );
    const missedConsensusRewards = this.calculateIncidentMissedConsensusRewards({
      openedTotals: openedValidatorRewardTotals,
      closedTotals: closedValidatorRewardTotals,
    });

    const closedNotificationQueuedAt = this.canQueueNotification(incident.cluster.owner)
      ? finalizedAt
      : null;

    const finalizedIncident = await tx.clusterIncident.update({
      where: { id: incident.id },
      data: {
        closedValidatorRewardTotals,
        missedConsensusRewards,
        rewardsFinalized: true,
        rewardsFinalizedAt: finalizedAt,
        closedNotificationQueuedAt,
      },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
    });

    if (closedNotificationQueuedAt !== null) {
      await this.queueClosedNotification(tx, finalizedIncident, finalizedAt);
    }

    return finalizedIncident;
  }

  async openIncidentIfMissing(
    tx: Prisma.TransactionClient,
    params: { clusterId: string; openedSlot: number; validatorIndexes: number[] },
  ) {
    const validatorIndexes = [...new Set(params.validatorIndexes)].sort((a, b) => a - b);
    const existing = await tx.clusterIncident.findFirst({
      where: {
        clusterId: params.clusterId,
        status: 'open',
      },
    });

    const currentRewardTotals = await this.getRewardTotalsSnapshot(tx, validatorIndexes);

    if (existing) {
      const mergedValidatorIndexes = [
        ...new Set([...existing.validatorIndexes, ...validatorIndexes]),
      ].sort((a, b) => a - b);
      const openedValidatorRewardTotals = this.parseRewardTotalsSnapshot(
        existing.openedValidatorRewardTotals,
      );

      for (const validatorIndex of validatorIndexes) {
        const key = String(validatorIndex);
        if (openedValidatorRewardTotals[key] === undefined) {
          openedValidatorRewardTotals[key] = currentRewardTotals[key] ?? {
            missedConsensusRewardsTotal: '0',
            missedSyncRewardsTotal: '0',
            missedAttestationsRewardsTotal: '0',
          };
        }
      }

      if (
        JSON.stringify(existing.validatorIndexes) === JSON.stringify(mergedValidatorIndexes) &&
        JSON.stringify(existing.openedValidatorRewardTotals ?? null) ===
          JSON.stringify(openedValidatorRewardTotals)
      ) {
        return existing;
      }

      return tx.clusterIncident.update({
        where: { id: existing.id },
        data: {
          validatorIndexes: mergedValidatorIndexes,
          openedValidatorRewardTotals,
          updatedAt: this.getSlotDate(params.openedSlot),
        },
      });
    }

    const cluster = await tx.cluster.findUniqueOrThrow({
      where: { id: params.clusterId },
      include: { owner: true },
    });

    const openedAt = this.getSlotDate(params.openedSlot);
    const openedNotificationQueuedAt = this.canQueueNotification(cluster.owner) ? openedAt : null;

    const incident = await tx.clusterIncident.create({
      data: {
        clusterId: params.clusterId,
        status: 'open',
        openedAt,
        openedSlot: params.openedSlot,
        validatorIndexes,
        openedValidatorRewardTotals: currentRewardTotals,
        openedNotificationQueuedAt,
        updatedAt: openedAt,
      },
    });

    if (openedNotificationQueuedAt !== null) {
      await tx.notificationQueue.create({
        data: {
          userId: cluster.ownerId,
          type: 'incident_opened',
          payload: {
            clusterId: cluster.id,
            clusterName: cluster.name,
            incidentId: incident.id,
            openedAt: openedAt.toISOString(),
            openedSlot: incident.openedSlot,
            validatorIndexes: incident.validatorIndexes,
          },
          delivered: false,
          createdAt: openedAt,
        },
      });
    }

    return incident;
  }

  async closeIncident(
    tx: Prisma.TransactionClient,
    params: { incidentId: string; closedSlot: number },
  ) {
    const incident = await tx.clusterIncident.findUniqueOrThrow({
      where: { id: params.incidentId },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
    });

    if (incident.status !== 'open') {
      return incident;
    }

    const closedAt = this.getSlotDate(params.closedSlot);
    const durationSlots = Math.max(params.closedSlot - incident.openedSlot, 0);
    const durationSeconds = Math.max(
      Math.floor((closedAt.getTime() - incident.openedAt.getTime()) / 1000),
      0,
    );

    await tx.clusterIncident.update({
      where: { id: incident.id },
      data: {
        status: 'closed',
        closedAt,
        closedSlot: params.closedSlot,
        durationSlots,
        durationSeconds,
        updatedAt: closedAt,
      },
    });

    return this.finalizeClosedIncidentIfReady(tx, incident.id, closedAt);
  }

  async finalizeClosedIncidentsIfReady(): Promise<void> {
    const finalizableIncidents = await this.prisma.clusterIncident.findMany({
      where: {
        status: 'closed',
        rewardsFinalized: false,
        closedSlot: { not: null },
      },
      select: { id: true, openedValidatorRewardTotals: true },
    });

    for (const incident of finalizableIncidents) {
      if (incident.openedValidatorRewardTotals === null) {
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await this.finalizeClosedIncidentIfReady(tx, incident.id, new Date());
      });
    }
  }

  async syncIncidents(params: { observedAt: Date; observedSlot: number }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const clusterStates = await tx.cluster.findMany({
        include: {
          owner: true,
          validators: {
            include: {
              validator: true,
            },
          },
          incidents: {
            where: { status: 'open' },
            take: 1,
          },
        },
      });

      for (const cluster of clusterStates) {
        const qualifyingValidatorIndexes = cluster.validators
          .filter((clusterValidator) => {
            const validatorStatus =
              clusterValidator.validator.status ?? VALIDATOR_STATUS.pending_initialized;

            return INCIDENT_TRACKED_BEACON_STATUSES.some((trackedStatus) => {
              return trackedStatus === validatorStatus;
            });
          })
          .map((clusterValidator) => clusterValidator.validatorIndex);

        const snapshots = await tx.validatorsSnapshotStats.findMany({
          where: {
            validatorIndex: { in: qualifyingValidatorIndexes },
          },
          select: {
            validatorIndex: true,
            consecutiveMissedAttestations: true,
            currentMissedStreakStartSlot: true,
          },
        });

        const currentlyQualifyingValidators = snapshots
          .filter(
            (snapshot) =>
              snapshot.currentMissedStreakStartSlot !== null &&
              snapshot.consecutiveMissedAttestations >= cluster.missedAttestationThreshold,
          )
          .map((snapshot) => snapshot.validatorIndex);

        const openIncident = cluster.incidents[0] ?? null;

        if (currentlyQualifyingValidators.length === 0) {
          if (openIncident !== null) {
            await this.closeIncident(tx, {
              incidentId: openIncident.id,
              closedSlot: params.observedSlot,
            });
          }
          continue;
        }

        const openedSlot = Math.min(
          ...snapshots
            .filter(
              (snapshot) =>
                snapshot.currentMissedStreakStartSlot !== null &&
                snapshot.consecutiveMissedAttestations >= cluster.missedAttestationThreshold,
            )
            .map(
              (snapshot) =>
                snapshot.currentMissedStreakStartSlot! + cluster.missedAttestationThreshold - 1,
            ),
        );

        await this.openIncidentIfMissing(tx, {
          clusterId: cluster.id,
          openedSlot,
          validatorIndexes: currentlyQualifyingValidators,
        });
      }
    });
  }
}
