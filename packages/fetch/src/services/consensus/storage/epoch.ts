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
        const batchSize = 50_000;
        const batches = chunk(processedRewards, batchSize);
        for (const batch of batches) {
          // Update HourlyValidatorData with pre-processed rewards string
          for (const validator of batch) {
            // Use raw SQL for proper string concatenation with CASE statement
            await tx.$executeRaw`
              INSERT INTO hourly_validator_data (datetime, validator_index, attestations, sync_committee_rewards, epoch_rewards)
              VALUES (${datetime}::timestamp, ${validator.validatorIndex}, '', '', CONCAT(${validator.rewards}, ','))
              ON CONFLICT (datetime, validator_index) DO UPDATE SET
                epoch_rewards = CONCAT(hourly_validator_data.epoch_rewards, EXCLUDED.epoch_rewards)
            `;
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
      INSERT INTO "slot" (slot, proposer)
      SELECT 
        unnest(${validatorProposerDuties.map((duty) => duty.slot)}::integer[]), 
        unnest(${validatorProposerDuties.map((duty) => duty.validatorIndex)}::integer[])
      ON CONFLICT (slot) DO UPDATE SET
        "proposer" = EXCLUDED."proposer"
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
    slotTimestamps: Map<number, Date>,
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

        // Insert committees in batches for better performance
        const batchSize = 100000;
        const batches = chunk(committees, batchSize);
        for (const batch of batches) {
          await tx.committee.createMany({
            data: batch,
          });
        }

        // Create a VALUES clause with slot-timestamp mappings for the SQL query
        const slotTimestampValues = slots
          .map((slot) => {
            const timestamp = slotTimestamps.get(slot);
            if (!timestamp) {
              throw new Error(`Missing timestamp for slot ${slot}`);
            }
            return `(${slot}, '${timestamp.toISOString()}'::timestamp)`;
          })
          .join(',');

        // Update HourlyValidatorData.slots
        await tx.$executeRawUnsafe(`
          INSERT INTO hourly_validator_data (datetime, validator_index, slots, attestations, sync_committee_rewards, proposed_blocks_rewards, epoch_rewards)
          SELECT 
            st.datetime,
            c.validator_index,
            CONCAT(c.slot::text, ',') as slots,
            '' as attestations,
            '' as sync_committee_rewards,
            '' as proposed_blocks_rewards,
            '' as epoch_rewards
          FROM committee c
          JOIN (VALUES ${slotTimestampValues}) AS st(slot, datetime) ON c.slot = st.slot
          ON CONFLICT (datetime, validator_index) DO UPDATE SET
            slots = CONCAT(hourly_validator_data.slots, EXCLUDED.slots)
        `);

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
        OR: [
          { rewardsFetched: false },
          { validatorsBalancesFetched: false },
          { validatorProposerDutiesFetched: false },
          { committeesFetched: false },
          { slotsFetched: false },
          { syncCommitteesFetched: false },
        ],
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
      select: {
        slot: true,
        proposer: true,
      },
      orderBy: [{ slot: 'asc' }],
    });
  }
}
