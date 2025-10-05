import { PrismaClient } from '@beacon-indexer/db';

export class EpochStorage {
  constructor(private readonly prisma: PrismaClient) {}

  private validateConsecutiveEpochs(epochs: number[]) {
    if (epochs.length === 0) {
      return;
    }

    // Sort epochs to ensure proper validation
    const sortedEpochs = [...epochs].sort((a, b) => a - b);

    for (let i = 1; i < sortedEpochs.length; i++) {
      if (sortedEpochs[i] !== sortedEpochs[i - 1] + 1) {
        throw new Error(
          `Epochs must be consecutive. Found gap between ${sortedEpochs[i - 1]} and ${sortedEpochs[i]}`,
        );
      }
    }
  }

  private async validateNextEpoch(epochs: number[]) {
    if (epochs.length === 0) {
      return;
    }

    const maxEpochResult = await this.getMaxEpoch();
    const minEpochToCreate = Math.min(...epochs);

    if (maxEpochResult === null) {
      // If no epochs exist in DB, any epoch is valid
      return;
    }

    const expectedNextEpoch = maxEpochResult.epoch + 1;
    if (minEpochToCreate !== expectedNextEpoch) {
      throw new Error(
        `First epoch to create (${minEpochToCreate}) must be the next epoch after the max epoch in DB (${maxEpochResult.epoch}). Expected: ${expectedNextEpoch}`,
      );
    }
  }

  async getMaxEpoch() {
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
    this.validateConsecutiveEpochs(epochsToCreate);

    await this.validateNextEpoch(epochsToCreate);

    const epochsData = epochsToCreate.map((epoch: number) => ({
      epoch: epoch,
      processed: false,
      validatorsBalancesFetched: false,
      rewardsFetched: false,
      committeesFetched: false,
      slotsFetched: false,
      syncCommitteesFetched: false,
    }));

    await this.prisma.epoch.createMany({
      data: epochsData,
    });
  }

  async getMinEpochToProcess() {
    const nextEpoch = await this.prisma.epoch.findFirst({
      where: {
        processed: false,
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

  async markEpochAsProcessed(epoch: number) {
    await this.prisma.epoch.update({
      where: { epoch },
      data: {
        processed: true,
      },
    });
  }

  async getAllEpochs() {
    return this.prisma.epoch.findMany({
      orderBy: { epoch: 'asc' },
    });
  }

  async getEpochCount() {
    return this.prisma.epoch.count();
  }
}
