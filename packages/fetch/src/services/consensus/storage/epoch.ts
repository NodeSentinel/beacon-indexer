import { PrismaClient, EpochRewardsTemp, Committee } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { ValidatorsStorage } from './validators.js';

export class EpochStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly validatorsStorage: ValidatorsStorage,
  ) {}

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

  /**
   * @internal
   * @testonly
   * Helper method for e2e tests only. Should not be used in production code.
   * @returns All epochs from the database ordered by epoch number
   */
  async getAllEpochs_e2e_only() {
    // Runtime check to prevent usage in production
    if (process.env.NODE_ENV === 'production') {
      throw new Error('getAllEpochs() is only available in test environments');
    }

    return this.prisma.epoch.findMany({
      orderBy: { epoch: 'asc' },
    });
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

  async getEpochCount() {
    return this.prisma.epoch.count();
  }

  /**
   * Check if sync committee for a specific epoch is already fetched
   */
  async checkSyncCommitteeForEpoch(epoch: number): Promise<{ isFetched: boolean }> {
    const syncCommittee = await this.prisma.syncCommittee.findFirst({
      where: {
        fromEpoch: { lte: epoch },
        toEpoch: { gte: epoch },
      },
    });

    return { isFetched: !!syncCommittee };
  }

  /**
   * Truncate temp table for attestation rewards
   */
  async truncateAttestationRewardsTempTable() {
    await this.prisma.$executeRaw`TRUNCATE TABLE "EpochRewardsTemp"`;
  }

  /**
   * Insert attestation rewards batch into temp table
   */
  async insertIntoEpochRewardsTemp(rewards: EpochRewardsTemp[]) {
    await this.prisma.epochRewardsTemp.createMany({
      data: rewards,
      skipDuplicates: true,
    });
  }

  /**
   * Process temp table and update epoch status for attestation rewards
   */
  async saveAttestationRewardsAndUpdateEpoch(epoch: number) {
    await this.prisma.$transaction(
      async (tx) => {
        // Merge data from temporary table to main table
        await tx.$executeRaw`
          INSERT INTO "HourlyValidatorStats" 
            ("validatorIndex", "date", "hour", "head", "target", "source", "inactivity", "missedHead", "missedTarget", "missedSource", "missedInactivity")
          SELECT 
            "validatorIndex", "date", "hour", "head", "target", "source", "inactivity", "missedHead", "missedTarget", "missedSource", "missedInactivity"
          FROM "EpochRewardsTemp"
          ON CONFLICT ("validatorIndex", "date", "hour") DO UPDATE SET
            "head" = COALESCE("HourlyValidatorStats"."head", 0) + COALESCE(EXCLUDED."head", 0),
            "target" = COALESCE("HourlyValidatorStats"."target", 0) + COALESCE(EXCLUDED."target", 0),
            "source" = COALESCE("HourlyValidatorStats"."source", 0) + COALESCE(EXCLUDED."source", 0),
            "inactivity" = COALESCE("HourlyValidatorStats"."inactivity", 0) + COALESCE(EXCLUDED."inactivity", 0),
            "missedHead" = COALESCE("HourlyValidatorStats"."missedHead", 0) + COALESCE(EXCLUDED."missedHead", 0),
            "missedTarget" = COALESCE("HourlyValidatorStats"."missedTarget", 0) + COALESCE(EXCLUDED."missedTarget", 0),
            "missedSource" = COALESCE("HourlyValidatorStats"."missedSource", 0) + COALESCE(EXCLUDED."missedSource", 0),
            "missedInactivity" = COALESCE("HourlyValidatorStats"."missedInactivity", 0) + COALESCE(EXCLUDED."missedInactivity", 0)
        `;

        // Update epoch status
        await tx.epoch.update({
          where: { epoch },
          data: { rewardsFetched: true },
        });
      },
      {
        timeout: ms('3m'),
      },
    );
  }

  /**
   * Save committees and update slots with committee counts
   */
  async saveCommitteesData(
    epoch: number,
    slots: number[],
    committees: Committee[],
    committeesCountInSlot: Map<number, number[]>,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "Slot" (slot, "attestationsProcessed", "committeesCountInSlot")
          SELECT 
            unnest(${slots}::integer[]), 
            false,
            unnest(${slots.map((slot) => JSON.stringify(committeesCountInSlot.get(slot) || []))}::jsonb[])
          ON CONFLICT (slot) DO UPDATE SET
            "committeesCountInSlot" = EXCLUDED."committeesCountInSlot"
        `;

        // Insert committees in batches for better performance
        const batchSize = 100000;
        const batches = chunk(committees, batchSize);
        for (const batch of batches) {
          await tx.committee.createMany({
            data: batch,
          });
        }

        // Update epoch status
        await tx.epoch.update({
          where: { epoch },
          data: { committeesFetched: true },
        });
      },
      {
        timeout: ms('5m'),
      },
    );
  }

  /**
   * Save sync committees and update epoch status
   */
  async saveSyncCommittees(
    epoch: number,
    fromEpoch: number,
    toEpoch: number,
    syncCommitteeData: {
      validators: string[];
      validator_aggregates: string[][];
    },
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.syncCommittee.upsert({
          where: {
            fromEpoch_toEpoch: {
              fromEpoch,
              toEpoch,
            },
          },
          create: {
            fromEpoch,
            toEpoch,
            validators: syncCommitteeData.validators,
            validatorAggregates: syncCommitteeData.validator_aggregates,
          },
          update: {},
        });

        await tx.epoch.update({
          where: { epoch },
          data: { syncCommitteesFetched: true },
        });
      },
      {
        timeout: ms('1m'),
      },
    );
  }

  /**
   * Update the epoch's slotsFetched flag to true
   */
  async updateSlotsFetched(epoch: number): Promise<{ success: boolean }> {
    await this.prisma.epoch.update({
      where: { epoch },
      data: { slotsFetched: true },
    });

    return { success: true };
  }

  /**
   * Update the epoch's syncCommitteesFetched flag to true
   */
  async updateSyncCommitteesFetched(epoch: number): Promise<{ success: boolean }> {
    await this.prisma.epoch.update({
      where: { epoch },
      data: { syncCommitteesFetched: true },
    });

    return { success: true };
  }
}
