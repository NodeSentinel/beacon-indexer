import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { Prisma, PrismaClient } from '@beacon-indexer/db';

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

    if (existing) {
      const mergedValidatorIndexes = [
        ...new Set([...existing.validatorIndexes, ...validatorIndexes]),
      ].sort((a, b) => a - b);

      if (JSON.stringify(existing.validatorIndexes) === JSON.stringify(mergedValidatorIndexes)) {
        return existing;
      }

      return tx.clusterIncident.update({
        where: { id: existing.id },
        data: {
          validatorIndexes: mergedValidatorIndexes,
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
        openedNotificationQueuedAt,
        updatedAt: openedAt,
      },
    });

    if (openedNotificationQueuedAt) {
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

    const closedIncident = await tx.clusterIncident.update({
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

    return closedIncident;
  }

  async syncIncidents(params: { observedAt: Date; observedSlot: number }): Promise<void> {
    const { observedSlot } = params;

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
        const trackedValidatorIndexes = cluster.validators
          .filter((clusterValidator) => {
            const validatorStatus =
              clusterValidator.validator.status ?? VALIDATOR_STATUS.pending_initialized;

            return INCIDENT_TRACKED_BEACON_STATUSES.some(
              (trackedStatus) => trackedStatus === validatorStatus,
            );
          })
          .map((clusterValidator) => clusterValidator.validatorIndex);

        const snapshots = await tx.validatorsSnapshotStats.findMany({
          where: {
            validatorIndex: { in: trackedValidatorIndexes },
          },
          select: {
            validatorIndex: true,
            isInactive: true,
            inactiveSinceSlot: true,
          },
        });

        const inactiveSnapshots = snapshots.filter(
          (snapshot) => snapshot.isInactive && snapshot.inactiveSinceSlot !== null,
        );
        const openIncident = cluster.incidents[0] ?? null;

        if (inactiveSnapshots.length === 0) {
          if (openIncident !== null) {
            await this.closeIncident(tx, {
              incidentId: openIncident.id,
              closedSlot: observedSlot,
            });
          }
          continue;
        }

        await this.openIncidentIfMissing(tx, {
          clusterId: cluster.id,
          openedSlot: Math.min(...inactiveSnapshots.map((snapshot) => snapshot.inactiveSinceSlot!)),
          validatorIndexes: inactiveSnapshots.map((snapshot) => snapshot.validatorIndex),
        });
      }
    });
  }
}
