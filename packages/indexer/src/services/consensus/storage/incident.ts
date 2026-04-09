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

  private getSlotDate(slot: number | bigint): Date {
    // Convert a consensus slot into a wall-clock timestamp using the configured
    // genesis time and slot duration for the active chain.
    const normalizedSlot = Number(slot);
    return new Date(
      this.chainTiming.genesisTimeSec * 1000 + normalizedSlot * this.chainTiming.secPerSlot * 1000,
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
    const openedSlot = Number(params.openedSlot);
    // Normalize validator membership so the persisted incident payload stays
    // deterministic even if callers pass duplicates or unsorted indexes.
    const validatorIndexes = [
      ...new Set(params.validatorIndexes.map((validatorIndex) => Number(validatorIndex))),
    ].sort((a, b) => a - b);
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
          updatedAt: this.getSlotDate(openedSlot),
        },
      });
    }

    // Creating a new incident also decides whether the opening notification can be
    // queued immediately for the cluster owner.
    const cluster = await tx.cluster.findUniqueOrThrow({
      where: { id: params.clusterId },
      include: { owner: true },
    });

    const openedAt = this.getSlotDate(openedSlot);
    const openedNotificationQueuedAt = this.canQueueNotification(cluster.owner) ? openedAt : null;

    const incident = await tx.clusterIncident.create({
      data: {
        clusterId: params.clusterId,
        status: 'open',
        openedAt,
        openedSlot,
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
    const closedSlot = Number(params.closedSlot);
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
    const closedAt = this.getSlotDate(closedSlot);
    const durationSlots = Math.max(closedSlot - incident.openedSlot, 0);
    const durationSeconds = Math.max(
      Math.floor((closedAt.getTime() - incident.openedAt.getTime()) / 1000),
      0,
    );

    const closedIncident = await tx.clusterIncident.update({
      where: { id: incident.id },
      data: {
        status: 'closed',
        closedAt,
        closedSlot,
        durationSlots,
        durationSeconds,
        updatedAt: closedAt,
      },
    });

    return closedIncident;
  }

  async reconcileOpenIncident(
    tx: Prisma.TransactionClient,
    params: {
      clusterId: string;
      slot: number;
      additions: number[];
      removals: number[];
    },
  ) {
    const slot = Number(params.slot);
    const additions = params.additions.map((validatorIndex) => Number(validatorIndex));
    const removals = params.removals.map((validatorIndex) => Number(validatorIndex));
    // Load the currently open incident so reconciliation always starts from the
    // latest durable validator membership for the cluster.
    const openIncident = await tx.clusterIncident.findFirst({
      where: {
        clusterId: params.clusterId,
        status: 'open',
      },
    });

    // Normalize the requested delta so the stored validator list stays ordered
    // and deterministic regardless of duplicate inputs.
    const mergedValidatorIndexes = [
      ...new Set([...(openIncident?.validatorIndexes ?? []), ...additions]),
    ]
      .filter((validatorIndex) => !removals.includes(validatorIndex))
      .sort((a, b) => a - b);

    // Open a brand-new incident only when the cluster just became non-empty.
    if (openIncident === null) {
      if (mergedValidatorIndexes.length === 0) {
        return null;
      }

      return this.openIncidentIfMissing(tx, {
        clusterId: params.clusterId,
        openedSlot: slot,
        validatorIndexes: mergedValidatorIndexes,
      });
    }

    // Close the open incident immediately once every validator has recovered.
    if (mergedValidatorIndexes.length === 0) {
      return this.closeIncident(tx, {
        incidentId: openIncident.id,
        closedSlot: slot,
      });
    }

    // Skip the write entirely when the cluster membership did not actually change.
    if (JSON.stringify(openIncident.validatorIndexes) === JSON.stringify(mergedValidatorIndexes)) {
      return openIncident;
    }

    // Persist the new validator membership while keeping the existing opened slot.
    return tx.clusterIncident.update({
      where: { id: openIncident.id },
      data: {
        validatorIndexes: mergedValidatorIndexes,
        updatedAt: this.getSlotDate(slot),
      },
    });
  }
}
