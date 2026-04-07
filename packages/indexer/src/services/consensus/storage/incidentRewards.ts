import { PrismaClient } from '@beacon-indexer/db';

export class IncidentRewardsStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: {
      slotsPerEpoch: number;
    },
  ) {}

  async syncOpenIncidentRewards(params: { processThroughSlot: number }): Promise<void> {
    const candidates = await this.prisma.clusterIncident.findMany({
      where: {
        OR: [{ status: 'open' }, { status: 'closed', rewardsFinalized: false }],
      },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
      orderBy: { openedSlot: 'asc' },
    });

    if (candidates.length === 0) {
      return;
    }

    const validatorIndexes = [
      ...new Set(candidates.flatMap((incident) => incident.validatorIndexes)),
    ];
    const snapshots = await this.prisma.validatorsSnapshotStats.findMany({
      where: { validatorIndex: { in: validatorIndexes } },
      select: {
        validatorIndex: true,
        rewardsProcessedThroughSlot: true,
      },
    });
    const snapshotByValidator = new Map(
      snapshots.map((snapshot) => [snapshot.validatorIndex, snapshot] as const),
    );

    const processedThroughByValidator = new Map<number, number>();

    for (const incident of candidates) {
      const upperBound =
        incident.status === 'closed' && incident.closedSlot !== null
          ? Math.min(incident.closedSlot, params.processThroughSlot)
          : params.processThroughSlot;

      if (upperBound < incident.openedSlot) {
        continue;
      }

      const hasUnprocessedRange = incident.validatorIndexes.some((validatorIndex) => {
        const snapshot = snapshotByValidator.get(validatorIndex);
        const processedThrough = snapshot?.rewardsProcessedThroughSlot ?? incident.openedSlot - 1;
        const lowerBound = Math.max(incident.openedSlot, processedThrough + 1);
        return lowerBound <= upperBound;
      });

      if (!hasUnprocessedRange) {
        continue;
      }

      let incidentDelta = BigInt(0);

      for (const validatorIndex of incident.validatorIndexes) {
        const snapshot = snapshotByValidator.get(validatorIndex);
        const processedThrough = snapshot?.rewardsProcessedThroughSlot ?? incident.openedSlot - 1;
        const lowerBound = Math.max(incident.openedSlot, processedThrough + 1);

        if (lowerBound > upperBound) {
          continue;
        }

        const startEpoch = Math.floor(lowerBound / this.chainTiming.slotsPerEpoch);
        const endEpoch = Math.floor(upperBound / this.chainTiming.slotsPerEpoch);

        const [epochRewardRows, syncRewardRows] = await Promise.all([
          this.prisma.epochRewards.findMany({
            where: {
              validatorIndex,
              epoch: {
                gte: startEpoch,
                lte: endEpoch,
              },
            },
            select: {
              missedHead: true,
              missedTarget: true,
              missedSource: true,
              missedInactivity: true,
            },
          }),
          this.prisma.validatorSyncRewards.findMany({
            where: {
              validatorIndex,
              slot: {
                gte: lowerBound,
                lte: upperBound,
              },
            },
            select: {
              syncCommittee: true,
            },
          }),
        ]);

        incidentDelta += epochRewardRows.reduce(
          (sum, row) =>
            sum + row.missedHead + row.missedTarget + row.missedSource + row.missedInactivity,
          BigInt(0),
        );
        incidentDelta += syncRewardRows.reduce((sum, row) => {
          return row.syncCommittee < 0 ? sum + -row.syncCommittee : sum;
        }, BigInt(0));

        processedThroughByValidator.set(
          validatorIndex,
          Math.max(processedThroughByValidator.get(validatorIndex) ?? -1, upperBound),
        );
        snapshotByValidator.set(validatorIndex, {
          validatorIndex,
          rewardsProcessedThroughSlot: upperBound,
        });
      }

      if (incidentDelta > BigInt(0)) {
        await this.prisma.clusterIncident.update({
          where: { id: incident.id },
          data: {
            missedConsensusRewards: (incident.missedConsensusRewards ?? BigInt(0)) + incidentDelta,
          },
        });
      }
    }

    for (const [validatorIndex, processedThroughSlot] of processedThroughByValidator) {
      await this.prisma.validatorsSnapshotStats.update({
        where: { validatorIndex },
        data: {
          rewardsProcessedThroughSlot: processedThroughSlot,
        },
      });
    }

    const finalizableClosedIncidents = await this.prisma.clusterIncident.findMany({
      where: {
        status: 'closed',
        rewardsFinalized: false,
        closedSlot: { lte: params.processThroughSlot },
      },
      include: {
        cluster: {
          include: { owner: true },
        },
      },
    });

    const finalizedAt = new Date();
    for (const incident of finalizableClosedIncidents) {
      const snapshotsForIncident = await this.prisma.validatorsSnapshotStats.findMany({
        where: {
          validatorIndex: { in: incident.validatorIndexes },
        },
        select: {
          validatorIndex: true,
          rewardsProcessedThroughSlot: true,
        },
      });

      const allCaughtUp = snapshotsForIncident.every(
        (snapshot) =>
          incident.closedSlot !== null &&
          (snapshot.rewardsProcessedThroughSlot ?? incident.openedSlot - 1) >= incident.closedSlot,
      );

      if (!allCaughtUp) {
        continue;
      }

      const updatedIncident = await this.prisma.clusterIncident.update({
        where: { id: incident.id },
        data: {
          rewardsFinalized: true,
          rewardsFinalizedAt: finalizedAt,
          closedNotificationQueuedAt:
            incident.cluster.owner.telegramId !== null && !incident.cluster.owner.hasBlockedBot
              ? finalizedAt
              : null,
        },
      });

      if (
        incident.cluster.owner.telegramId !== null &&
        !incident.cluster.owner.hasBlockedBot &&
        updatedIncident.closedNotificationQueuedAt
      ) {
        await this.prisma.notificationQueue.create({
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
              missedConsensusRewards: updatedIncident.missedConsensusRewards?.toString() ?? null,
            },
            delivered: false,
            createdAt: finalizedAt,
          },
        });
      }
    }
  }
}
