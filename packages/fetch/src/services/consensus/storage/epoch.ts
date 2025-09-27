import { PrismaClient } from '@beacon-indexer/db';

export class EpochStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async getLastCreated() {
    return await this.prisma.epoch.findFirst({
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
    });
  }

  async getUnprocessedCount() {
    return this.prisma.epoch.count({
      where: {
        OR: [
          { rewardsFetched: false },
          { validatorsBalancesFetched: false },
          { committeesFetched: false },
          { slotsFetched: false },
          { syncCommitteesFetched: false },
        ],
      },
    });
  }

  async createEpochs(epochsToCreate: number[]) {
    const epochsData = epochsToCreate.map((epoch: number) => ({
      epoch: epoch,
      validatorsBalancesFetched: false,
      rewardsFetched: false,
      committeesFetched: false,
      slotsFetched: false,
      syncCommitteesFetched: false,
    }));

    await this.prisma.epoch.createMany({
      data: epochsData,
      skipDuplicates: true,
    });
  }

  async getMinEpochToProcess() {
    const nextEpoch = await this.prisma.epoch.findFirst({
      where: {
        OR: [
          { validatorsBalancesFetched: false },
          { rewardsFetched: false },
          { committeesFetched: false },
          { slotsFetched: false },
          { validatorsActivationFetched: false },
        ],
      },
      orderBy: { epoch: 'asc' },
    });

    if (!nextEpoch) {
      return null;
    }

    return {
      ...nextEpoch,
    };
  }
}
