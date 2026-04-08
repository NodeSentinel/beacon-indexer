import { Prisma, PrismaClient } from '@beacon-indexer/db';

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
    // Convert a consensus slot into a wall-clock timestamp using the configured
    // genesis time and slot duration for the active chain.
    return new Date(
      this.chainTiming.genesisTimeSec * 1000 + slot * this.chainTiming.secPerSlot * 1000,
    );
  }

  private canQueueNotification(user: {
    telegramId: bigint | null;
    hasBlockedBot: boolean;
  }): boolean {
    // Gate notification queue writes to users that are currently eligible to
    // receive Telegram messages.
    return user.telegramId !== null && user.hasBlockedBot === false;
  }

  async openIncidentIfMissing(
    tx: Prisma.TransactionClient,
    params: { clusterId: string; openedSlot: number; validatorIndexes: number[] },
  ) {
    // Normalize validator membership so the persisted incident payload stays
    // deterministic even if callers pass duplicates or unsorted indexes.
    const validatorIndexes = [...new Set(params.validatorIndexes)].sort((a, b) => a - b);
    const existing = await tx.clusterIncident.findFirst({
      where: {
        clusterId: params.clusterId,
        status: 'open',
      },
    });

    // Reuse the existing open incident for the cluster when one already exists,
    // widening the validator set only when new inactive validators joined it.
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

    // Creating a new incident also decides whether the opening notification can be
    // queued immediately for the cluster owner.
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
    // Re-read the incident inside the transaction so close decisions always use
    // the latest durable incident state.
    const incident = await tx.clusterIncident.findUniqueOrThrow({
      where: { id: params.incidentId },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
    });

    // Preserve idempotency for callers that may attempt to close an incident that
    // was already closed by an earlier slot or worker run.
    if (incident.status !== 'open') {
      return incident;
    }

    // Derive the persisted duration fields from the slot-based close boundary so
    // downstream consumers do not need to recompute them.
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
}
