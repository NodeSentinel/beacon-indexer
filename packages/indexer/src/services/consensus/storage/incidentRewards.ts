import { PrismaClient } from '@beacon-indexer/db';

export class IncidentRewardsStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: {
      slotsPerEpoch: number;
    },
  ) {}

  private sumMissedAttestationRewards(
    rows: Array<{
      validatorIndex: number;
      epoch: number;
      missedHead: bigint;
      missedTarget: bigint;
      missedSource: bigint;
      missedInactivity: bigint;
    }>,
    validatorIndex: number,
    startEpoch: number,
    endEpoch: number,
  ): bigint {
    return rows.reduce((sum, row) => {
      if (row.validatorIndex !== validatorIndex || row.epoch < startEpoch || row.epoch > endEpoch) {
        return sum;
      }

      return sum + row.missedHead + row.missedTarget + row.missedSource + row.missedInactivity;
    }, BigInt(0));
  }

  private sumMissedSyncRewards(
    rows: Array<{
      validatorIndex: number;
      slot: number;
      syncCommittee: bigint;
    }>,
    validatorIndex: number,
    lowerBound: number,
    upperBound: number,
  ): bigint {
    return rows.reduce((sum, row) => {
      if (
        row.validatorIndex !== validatorIndex ||
        row.slot < lowerBound ||
        row.slot > upperBound ||
        row.syncCommittee >= 0
      ) {
        return sum;
      }

      return sum + -row.syncCommittee;
    }, BigInt(0));
  }

  async syncOpenIncidentRewards(params: { processThroughSlot: number }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.clusterIncident.findMany({
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
      const snapshots = await tx.validatorsSnapshotStats.findMany({
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

        const ranges = incident.validatorIndexes
          .map((validatorIndex) => {
            const snapshot = snapshotByValidator.get(validatorIndex);
            const processedThrough =
              snapshot?.rewardsProcessedThroughSlot ?? incident.openedSlot - 1;
            const lowerBound = Math.max(incident.openedSlot, processedThrough + 1);

            return {
              validatorIndex,
              lowerBound,
              upperBound,
              startEpoch: Math.floor(lowerBound / this.chainTiming.slotsPerEpoch),
              endEpoch: Math.floor(upperBound / this.chainTiming.slotsPerEpoch),
            };
          })
          .filter((range) => range.lowerBound <= range.upperBound);

        if (ranges.length === 0) {
          continue;
        }

        const [epochRewardRows, syncRewardRows] = await Promise.all([
          tx.epochRewards.findMany({
            where: {
              validatorIndex: { in: ranges.map((range) => range.validatorIndex) },
              epoch: {
                gte: Math.min(...ranges.map((range) => range.startEpoch)),
                lte: Math.max(...ranges.map((range) => range.endEpoch)),
              },
            },
            select: {
              validatorIndex: true,
              epoch: true,
              missedHead: true,
              missedTarget: true,
              missedSource: true,
              missedInactivity: true,
            },
          }),
          tx.validatorSyncRewards.findMany({
            where: {
              validatorIndex: { in: ranges.map((range) => range.validatorIndex) },
              slot: {
                gte: Math.min(...ranges.map((range) => range.lowerBound)),
                lte: Math.max(...ranges.map((range) => range.upperBound)),
              },
            },
            select: {
              validatorIndex: true,
              slot: true,
              syncCommittee: true,
            },
          }),
        ]);

        let incidentDelta = BigInt(0);

        for (const range of ranges) {
          incidentDelta += this.sumMissedAttestationRewards(
            epochRewardRows,
            range.validatorIndex,
            range.startEpoch,
            range.endEpoch,
          );
          incidentDelta += this.sumMissedSyncRewards(
            syncRewardRows,
            range.validatorIndex,
            range.lowerBound,
            range.upperBound,
          );

          processedThroughByValidator.set(
            range.validatorIndex,
            Math.max(processedThroughByValidator.get(range.validatorIndex) ?? -1, upperBound),
          );
          snapshotByValidator.set(range.validatorIndex, {
            validatorIndex: range.validatorIndex,
            rewardsProcessedThroughSlot: upperBound,
          });
        }

        if (incidentDelta > BigInt(0)) {
          await tx.clusterIncident.update({
            where: { id: incident.id },
            data: {
              missedConsensusRewards:
                (incident.missedConsensusRewards ?? BigInt(0)) + incidentDelta,
            },
          });
        }
      }

      for (const [validatorIndex, processedThroughSlot] of processedThroughByValidator) {
        await tx.validatorsSnapshotStats.update({
          where: { validatorIndex },
          data: {
            rewardsProcessedThroughSlot: processedThroughSlot,
          },
        });
      }

      const finalizableClosedIncidents = candidates.filter(
        (incident) =>
          incident.status === 'closed' &&
          !incident.rewardsFinalized &&
          incident.closedSlot !== null &&
          incident.closedSlot <= params.processThroughSlot,
      );

      const finalizedAt = new Date();
      for (const incident of finalizableClosedIncidents) {
        const allCaughtUp = incident.validatorIndexes.every((validatorIndex) => {
          const snapshot = snapshotByValidator.get(validatorIndex);

          return (
            incident.closedSlot !== null &&
            (snapshot?.rewardsProcessedThroughSlot ?? incident.openedSlot - 1) >=
              incident.closedSlot
          );
        });

        if (!allCaughtUp) {
          continue;
        }

        const updatedIncident = await tx.clusterIncident.update({
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
                missedConsensusRewards: updatedIncident.missedConsensusRewards?.toString() ?? null,
              },
              delivered: false,
              createdAt: finalizedAt,
            },
          });
        }
      }
    });
  }
}
