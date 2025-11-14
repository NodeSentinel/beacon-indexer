import { PrismaClient, Committee, Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { ValidatorsStorage } from './validators.js';

/**
 * EpochStorage - Database persistence layer for epoch-related operations
 *
 * This class handles all database operations for epochs, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, data conversion, and processing happens in the controller layer.
 *
 * NEW EPOCH REWARDS STRATEGY:
 * - processEpochRewardsAndAggregate() handles the complete rewards processing in a single atomic transaction
 * - No longer uses EpochRewards table (removed from schema)
 * - Directly stores epoch rewards in HourlyValidatorData.epochRewards using string format
 * - Aggregates rewards into HourlyValidatorStats in the same transaction
 * - rewardsAggregated flag is no longer needed
 */
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

  async createEpochs(epochsToCreate: number[]) {
    this.validateConsecutiveEpochs(epochsToCreate);

    await this.validateNextEpoch(epochsToCreate);

    const epochsData: Prisma.EpochCreateManyInput[] = epochsToCreate.map((epoch: number) => ({
      epoch: epoch,
      processed: false,
      validatorsBalancesFetched: false,
      rewardsFetched: false,
      committeesFetched: false,
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
  async isSyncCommitteeForEpochInDB(epoch: number): Promise<{ isFetched: boolean }> {
    const syncCommittee = await this.prisma.syncCommittee.findFirst({
      where: {
        fromEpoch: { lte: epoch },
        toEpoch: { gte: epoch },
      },
    });

    return { isFetched: !!syncCommittee };
  }

  async isValidatorProposerDutiesFetched(epoch: number) {
    const epochData = await this.prisma.epoch.findUnique({
      where: { epoch },
      select: { validatorProposerDutiesFetched: true },
    });

    return Boolean(epochData?.validatorProposerDutiesFetched);
  }

  /**
   * Process epoch rewards and aggregate them into hourly validator data in a single atomic transaction.
   *
   * @param epoch - The epoch number to process
   * @param datetime - The datetime for the hourly aggregation
   * @param processedRewards - Array of pre-processed reward data ready for storage
   */
  async processEpochRewardsAndAggregate(
    epoch: number,
    datetime: Date,
    processedRewards: Array<{
      validatorIndex: number;
      clRewards: bigint;
      clMissedRewards: bigint;
      rewards: string; // Format: 'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity'
    }>,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        // Process rewards in batches to avoid memory issues
        // Note: epoch rewards are now stored in epochRewards table, not hourly_validator_data
        // The rewards string format needs to be parsed to extract individual values
        const batchSize = 50_000;
        const batches = chunk(processedRewards, batchSize);
        for (const batch of batches) {
          // Save epoch rewards to epochRewards table
          for (const validator of batch) {
            // Parse rewards string: 'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity'
            const rewardsParts = validator.rewards.split(':');
            const head = BigInt(rewardsParts[1] || '0');
            const target = BigInt(rewardsParts[2] || '0');
            const source = BigInt(rewardsParts[3] || '0');
            const inactivity = BigInt(rewardsParts[4] || '0');
            const missedHead = BigInt(rewardsParts[5] || '0');
            const missedTarget = BigInt(rewardsParts[6] || '0');
            const missedSource = BigInt(rewardsParts[7] || '0');
            const missedInactivity = BigInt(rewardsParts[8] || '0');

            await tx.epochRewards.upsert({
              where: {
                epoch_validatorIndex: {
                  epoch,
                  validatorIndex: validator.validatorIndex,
                },
              },
              create: {
                epoch,
                validatorIndex: validator.validatorIndex,
                head,
                target,
                source,
                inactivity,
                missedHead,
                missedTarget,
                missedSource,
                missedInactivity,
              },
              update: {
                head,
                target,
                source,
                inactivity,
                missedHead,
                missedTarget,
                missedSource,
                missedInactivity,
              },
            });
          }
        }

        // Aggregate rewards into HourlyValidatorStats using pre-calculated values
        // Process in batches to avoid SQL parameter limits
        const statsBatchSize = 1000;
        const statsBatches = chunk(processedRewards, statsBatchSize);

        for (const statsBatch of statsBatches) {
          const valuesClause = statsBatch
            .map(
              (r) =>
                `(${r.validatorIndex}, ${r.clRewards.toString()}, ${r.clMissedRewards.toString()})`,
            )
            .join(',');

          await tx.$executeRawUnsafe(`
            INSERT INTO hourly_validator_stats 
              (datetime, validator_index, cl_rewards, cl_missed_rewards)
            SELECT 
              '${datetime.toISOString()}'::timestamp as datetime,
              validator_index,
              cl_rewards,
              cl_missed_rewards
            FROM (VALUES ${valuesClause}) AS rewards(validator_index, cl_rewards, cl_missed_rewards)
            ON CONFLICT (datetime, validator_index) DO UPDATE SET
              cl_rewards = hourly_validator_stats.cl_rewards + EXCLUDED.cl_rewards,
              cl_missed_rewards = hourly_validator_stats.cl_missed_rewards + EXCLUDED.cl_missed_rewards
          `);
        }

        // Mark epoch as rewardsFetched = true (rewardsAggregated is no longer needed)
        await tx.epoch.update({
          where: { epoch },
          data: { rewardsFetched: true },
        });
      },
      {
        timeout: ms('2m'),
      },
    );
  }

  async saveValidatorProposerDuties(
    epoch: number,
    validatorProposerDuties: { slot: number; validatorIndex: number }[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
      INSERT INTO "slot" (slot, proposer_index)
      SELECT 
        unnest(${validatorProposerDuties.map((duty) => duty.slot)}::integer[]), 
        unnest(${validatorProposerDuties.map((duty) => duty.validatorIndex)}::integer[])
      ON CONFLICT (slot) DO UPDATE SET
        proposer_index = EXCLUDED.proposer_index
    `;

      await tx.epoch.update({
        where: { epoch },
        data: { validatorProposerDutiesFetched: true },
      });
    });
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
          INSERT INTO "slot" (slot, processed, "committees_count_in_slot")
          SELECT 
            unnest(${slots}::integer[]), 
            false,
            unnest(${slots.map((slot) => JSON.stringify(committeesCountInSlot.get(slot) || []))}::jsonb[])
          ON CONFLICT (slot) DO UPDATE SET
            "committees_count_in_slot" = EXCLUDED."committees_count_in_slot"
        `;

        // Insert committees using temporary table for better performance
        await tx.$executeRaw`
          CREATE TEMPORARY TABLE tmp_committee (LIKE "committee") ON COMMIT DROP;
        `;

        // PostgreSQL limit: 32,767 bind variables per prepared statement
        // With 5 columns per row, max batch size = 32,767 / 5 ≈ 6,500 rows
        const batchSize = 6_500;
        const batches = chunk(committees, batchSize);
        for (const batch of batches) {
          await tx.$executeRaw`
            INSERT INTO tmp_committee (slot, index, "aggregation_bits_index", "validator_index", "attestation_delay")
            VALUES ${Prisma.join(
              batch.map(
                (c) =>
                  Prisma.sql`(${c.slot}, ${c.index}, ${c.aggregationBitsIndex}, ${c.validatorIndex}, ${c.attestationDelay})`,
              ),
            )}
          `;
        }

        // Copy all data from temporary table to Committee table in one operation
        await tx.$executeRaw`
          INSERT INTO "committee" (slot, index, "aggregation_bits_index", "validator_index", "attestation_delay")
          SELECT slot, index, "aggregation_bits_index", "validator_index", "attestation_delay"
          FROM tmp_committee;
        `;

        // Create a VALUES clause with slot-timestamp mappings for the SQL query
        // const slotTimestampValues = slots
        //   .map((slot) => {
        //     const timestamp = slotTimestamps.get(slot);
        //     if (!timestamp) {
        //       throw new Error(`Missing timestamp for slot ${slot}`);
        //     }
        //     return `(${slot}, '${timestamp.toISOString()}'::timestamp)`;
        //   })
        //   .join(',');

        // Note: slots information is now stored in Committee table
        // The slot field already exists in Committee, so no additional storage needed
        // This was previously storing in hourly_validator_data which no longer exists

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
    await this.prisma.$transaction(async (tx) => {
      await tx.syncCommittee.create({
        data: {
          fromEpoch,
          toEpoch,
          validators: syncCommitteeData.validators,
          validatorAggregates: syncCommitteeData.validator_aggregates,
        },
      });

      await tx.epoch.update({
        where: { epoch },
        data: { syncCommitteesFetched: true },
      });
    });
  }

  /**
   * Update the epoch's allSlotsProcessed flag to true
   */
  async setAllSlotsProcessed(epoch: number): Promise<{ success: boolean }> {
    await this.prisma.epoch.update({
      where: { epoch },
      data: { allSlotsProcessed: true },
    });

    return { success: true };
  }

  /**
   * Update the epoch's committeesFetched flag to true
   */
  async updateCommitteesFetched(epoch: number): Promise<{ success: boolean }> {
    await this.prisma.epoch.update({
      where: { epoch },
      data: { committeesFetched: true },
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
   * Update the epoch's validatorsActivationFetched flag to true
   */
  async updateValidatorsActivationFetched(epoch: number): Promise<{ success: boolean }> {
    await this.prisma.epoch.update({
      where: { epoch },
      data: { validatorsActivationFetched: true },
    });

    return { success: true };
  }

  /**
   * Get hourly validator attestation stats for specific validators and datetime
   */
  async getHourlyValidatorAttestationStats(validatorIndexes: number[], datetime: Date) {
    return this.prisma.hourlyValidatorStats.findMany({
      where: {
        validatorIndex: { in: validatorIndexes },
        datetime: datetime,
      },
      orderBy: [{ validatorIndex: 'asc' }],
    });
  }

  /**
   * Get all hourly validator attestation stats for a specific datetime
   */
  async getAllHourlyValidatorAttestationStats(datetime: Date) {
    return this.prisma.hourlyValidatorStats.findMany({
      where: {
        datetime: datetime,
      },
      orderBy: [{ validatorIndex: 'asc' }],
    });
  }

  /**
   * Get the last processed epoch from hourlyValidatorStats
   */
  async getLastProcessedEpoch(): Promise<number | null> {
    const result = await this.prisma.epoch.findFirst({
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
      where: { processed: true },
    });

    return result?.epoch ?? null;
  }

  /**
   * Get all committees for specific slots
   */
  async getCommitteesBySlots(slots: number[]) {
    return this.prisma.committee.findMany({
      where: {
        slot: { in: slots },
      },
      orderBy: [{ slot: 'asc' }, { index: 'asc' }, { aggregationBitsIndex: 'asc' }],
    });
  }

  /**
   * @returns All epochs from the database ordered by epoch number
   */
  async getAllEpochs() {
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
        processed: false,
      },
    });
  }

  /**
   * Get slots with proposers for specific slot numbers
   */
  async getSlotsBySlotNumbers(slots: number[]) {
    return this.prisma.slot.findMany({
      where: {
        slot: { in: slots },
      },
    });
  }
}
