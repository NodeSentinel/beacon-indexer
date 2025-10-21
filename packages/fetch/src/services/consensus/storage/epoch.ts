import { PrismaClient, Committee, Prisma } from '@beacon-indexer/db';
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
          { rewards_fetched: false },
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
      rewards_fetched: false,
      rewards_summarized: false,
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

  async getEpochByNumber(epoch: number) {
    return this.prisma.epoch.findUnique({ where: { epoch } });
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
   * Save epoch rewards and mark as fetched (atomic operation)
   */
  async saveEpochRewardsAndMarkFetched(
    epoch: number,
    rewards: Prisma.epoch_rewardsCreateManyInput[],
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        // Save rewards to epoch_rewards table
        await tx.epoch_rewards.createMany({
          data: rewards,
        });

        // Mark epoch as rewards_fetched = true
        await tx.epoch.update({
          where: { epoch },
          data: { rewards_fetched: true },
        });
      },
      {
        timeout: ms('3m'),
      },
    );
  }

  /**
   * Summarize epoch rewards and mark as summarized (atomic operation)
   */
  async summarizeEpochRewardsAndMarkSummarized(epoch: number, datetime: Date) {
    await this.prisma.$transaction(
      async (tx) => {
        // Aggregate epoch_rewards into hourly_validator_attestation_stats
        await tx.$executeRaw`
          INSERT INTO hourly_validator_attestation_stats 
            (validator_index, datetime, attestation_rewards, missed_attestations, last_epoch_processed)
          SELECT 
            validator_index,
            ${datetime}::timestamp as datetime,
            COALESCE(SUM(head + target + source + inactivity), 0) as attestation_rewards,
            COALESCE(SUM(CASE WHEN (missed_head > 0 OR missed_target > 0 OR missed_source > 0 OR missed_inactivity > 0) THEN 1 ELSE 0 END), 0) as missed_attestations,
            ${epoch} as last_epoch_processed
          FROM epoch_rewards 
          WHERE epoch = ${epoch}
          GROUP BY validator_index
          ON CONFLICT (validator_index, datetime) DO UPDATE SET
            attestation_rewards = hourly_validator_attestation_stats.attestation_rewards + EXCLUDED.attestation_rewards,
            missed_attestations = hourly_validator_attestation_stats.missed_attestations + EXCLUDED.missed_attestations,
            last_epoch_processed = EXCLUDED.last_epoch_processed
        `;

        // Mark epoch as rewards_summarized = true
        await tx.epoch.update({
          where: { epoch },
          data: { rewards_summarized: true },
        });
      },
      {
        timeout: ms('1m'),
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

  /**
   * Get hourly validator attestation stats for specific validators and datetime
   * @internal
   * @testonly
   * Helper method for e2e tests only. Should not be used in production code.
   */
  async getHourlyValidatorAttestationStats_e2e_only(validatorIndexes: number[], datetime: Date) {
    return this.prisma.hourly_validator_attestation_stats.findMany({
      where: {
        validator_index: { in: validatorIndexes },
        datetime: datetime,
      },
      orderBy: [{ validator_index: 'asc' }],
    });
  }

  /**
   * Get all hourly validator attestation stats for a specific datetime
   * @internal
   * @testonly
   * Helper method for e2e tests only. Should not be used in production code.
   */
  async getAllHourlyValidatorAttestationStats_e2e_only(datetime: Date) {
    return this.prisma.hourly_validator_attestation_stats.findMany({
      where: {
        datetime: datetime,
      },
      orderBy: [{ validator_index: 'asc' }],
    });
  }

  /**
   * Get the last processed epoch from hourly_validator_attestation_stats
   */
  async getLastProcessedEpoch(): Promise<number | null> {
    const result = await this.prisma.hourly_validator_attestation_stats.findFirst({
      orderBy: { last_epoch_processed: 'desc' },
      select: { last_epoch_processed: true },
    });

    return result?.last_epoch_processed ?? null;
  }
}
