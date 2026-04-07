import { PrismaClient } from '@beacon-indexer/db';

import { IncidentStorage } from './incident.js';

export class ValidatorRewardsProgressStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: {
      slotsPerEpoch: number;
    },
    private readonly incidentStorage: IncidentStorage,
  ) {}

  private getEpochEndSlot(epoch: number): number {
    return (epoch + 1) * this.chainTiming.slotsPerEpoch - 1;
  }

  async syncValidatorRewardsProgress(params: { processThroughSlot: number }): Promise<void> {
    const snapshots = await this.prisma.validatorsSnapshotStats.findMany({
      select: {
        validatorIndex: true,
        rewardsProcessedThroughSlot: true,
        missedConsensusRewardsTotal: true,
        missedSyncRewardsTotal: true,
        missedAttestationsRewardsTotal: true,
      },
    });

    if (snapshots.length === 0) {
      await this.incidentStorage.finalizeClosedIncidentsIfReady();
      return;
    }

    const validatorIndexes = snapshots.map((snapshot) => snapshot.validatorIndex);
    const maxProcessEpoch = Math.floor(params.processThroughSlot / this.chainTiming.slotsPerEpoch);

    const latestAvailableEpochRows = await this.prisma.$queryRaw<
      Array<{ validator_index: number; latest_available_epoch: number }>
    >`
      SELECT
        er.validator_index,
        MAX(er.epoch)::int AS latest_available_epoch
      FROM epoch_rewards er
      WHERE er.validator_index = ANY(${validatorIndexes}::int[])
        AND er.epoch <= ${maxProcessEpoch}::int
      GROUP BY er.validator_index
    `;

    const latestAvailableEpochByValidator = new Map(
      latestAvailableEpochRows.map(
        (row) => [row.validator_index, row.latest_available_epoch] as const,
      ),
    );

    for (const snapshot of snapshots) {
      const latestAvailableEpoch = latestAvailableEpochByValidator.get(snapshot.validatorIndex);
      if (latestAvailableEpoch === undefined) {
        continue;
      }

      const nextUnprocessedSlot = (snapshot.rewardsProcessedThroughSlot ?? -1) + 1;
      const validatorUpperBound = Math.min(
        params.processThroughSlot,
        this.getEpochEndSlot(latestAvailableEpoch),
      );

      if (nextUnprocessedSlot > validatorUpperBound) {
        continue;
      }

      const startEpoch = Math.floor(nextUnprocessedSlot / this.chainTiming.slotsPerEpoch);
      const endEpoch = Math.floor(validatorUpperBound / this.chainTiming.slotsPerEpoch);

      const [epochRewardRows, syncRewardRows] = await Promise.all([
        this.prisma.epochRewards.findMany({
          where: {
            validatorIndex: snapshot.validatorIndex,
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
            validatorIndex: snapshot.validatorIndex,
            slot: {
              gte: nextUnprocessedSlot,
              lte: validatorUpperBound,
            },
          },
          select: {
            syncCommittee: true,
          },
        }),
      ]);

      const missedAttestationsRewardsDelta = epochRewardRows.reduce(
        (sum, row) =>
          sum + row.missedHead + row.missedTarget + row.missedSource + row.missedInactivity,
        BigInt(0),
      );
      const missedSyncRewardsDelta = syncRewardRows.reduce((sum, row) => {
        return row.syncCommittee < 0 ? sum + -row.syncCommittee : sum;
      }, BigInt(0));

      await this.prisma.validatorsSnapshotStats.update({
        where: { validatorIndex: snapshot.validatorIndex },
        data: {
          rewardsProcessedThroughSlot: validatorUpperBound,
          missedAttestationsRewardsTotal:
            snapshot.missedAttestationsRewardsTotal + missedAttestationsRewardsDelta,
          missedSyncRewardsTotal: snapshot.missedSyncRewardsTotal + missedSyncRewardsDelta,
          missedConsensusRewardsTotal:
            snapshot.missedConsensusRewardsTotal +
            missedAttestationsRewardsDelta +
            missedSyncRewardsDelta,
        },
      });
    }

    await this.incidentStorage.finalizeClosedIncidentsIfReady();
  }
}
