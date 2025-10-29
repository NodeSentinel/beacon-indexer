import { PrismaClient, Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

/**
 * SlotStorage - Database persistence layer for slot-related operations
 *
 * This class handles all database operations for slots, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, data conversion, and processing happens in the controller layer.
 */
export class SlotStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get slot by number with processing data
   */
  async getSlot(slot: number) {
    return this.prisma.slot.findFirst({
      where: {
        slot: slot,
      },
      include: {
        processingData: true,
      },
    });
  }

  /**
   * Check if sync committee data exists for a given slot
   */
  async isSyncCommitteeFetchedForSlot(slot: number) {
    const res = await this.prisma.slotProcessingData.findFirst({
      where: { slot: slot },
      select: {
        syncRewardsProcessed: true,
      },
    });

    return res?.syncRewardsProcessed === true;
  }

  /**
   * Check if block rewards data exists for a given slot
   */
  async isBlockRewardsFetchedForSlot(slot: number) {
    const res = await this.prisma.slotProcessingData.findFirst({
      where: { slot: slot },
      select: { blockRewardsProcessed: true },
    });

    return res?.blockRewardsProcessed === true;
  }

  /**
   * Create slot processing data
   */
  async createSlotProcessingData(data: Prisma.SlotProcessingDataUncheckedCreateInput) {
    return this.prisma.slotProcessingData.create({
      data,
    });
  }

  /**
   * Update slot processing data
   */
  async updateSlotProcessingData(slot: number, data: Prisma.SlotProcessingDataUpdateInput) {
    return this.prisma.slotProcessingData.update({
      where: { slot },
      data,
    });
  }

  /**
   * Update slot processed status
   */
  async updateSlotProcessed(slot: number) {
    return this.prisma.slot.update({
      where: {
        slot: slot,
      },
      data: {
        processed: true,
      },
    });
  }

  /**
   * Update attestations processed status
   */
  async updateAttestationsProcessed(slot: number) {
    return this.prisma.slotProcessingData.update({
      where: { slot: slot },
      data: { attestationsProcessed: true },
    });
  }

  /**
   * Update block and sync rewards processed status
   */
  async updateBlockAndSyncRewardsProcessed(slot: number) {
    return this.prisma.slotProcessingData.upsert({
      where: { slot },
      update: {
        syncRewardsProcessed: true,
        blockRewardsProcessed: true,
      },
      create: {
        slot,
        syncRewardsProcessed: true,
        blockRewardsProcessed: true,
      },
    });
  }

  /**
   * Update execution rewards processed status
   */
  async updateExecutionRewardsProcessed(slot: number) {
    return this.prisma.slotProcessingData.update({
      where: {
        slot: slot,
      },
      data: {
        executionRewardsProcessed: true,
      },
    });
  }

  /**
   * Update slot with beacon data (withdrawals, deposits, etc.)
   */
  async updateSlotWithBeaconData(
    slot: number,
    data: Pick<
      Prisma.SlotProcessingDataUpdateInput,
      | 'withdrawalsRewards'
      | 'clDeposits'
      | 'clVoluntaryExits'
      | 'elDeposits'
      | 'elWithdrawals'
      | 'elConsolidations'
    >,
  ) {
    return this.prisma.slotProcessingData.update({
      where: { slot },
      data: {
        withdrawalsRewards: data.withdrawalsRewards || [],
        clDeposits: data.clDeposits || [],
        clVoluntaryExits: data.clVoluntaryExits || [],
        elDeposits: data.elDeposits || [],
        elWithdrawals: data.elWithdrawals || [],
        elConsolidations: data.elConsolidations || [],
      },
    });
  }

  /**
   * Save execution rewards to database
   */
  async saveExecutionRewards(data: Prisma.ExecutionRewardsUncheckedCreateInput) {
    return this.prisma.executionRewards.create({
      data,
    });
  }

  /**
   * Save sync committee rewards to database
   */
  async saveSyncCommitteeRewards(
    rewards: Array<{
      validatorIndex: number;
      date: Date;
      hour: number;
      syncCommittee: bigint;
    }>,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        for (const reward of rewards) {
          await tx.hourlyBlockAndSyncRewards.upsert({
            where: {
              validatorIndex_date_hour: {
                validatorIndex: reward.validatorIndex,
                date: reward.date,
                hour: reward.hour,
              },
            },
            create: {
              validatorIndex: reward.validatorIndex,
              date: reward.date,
              hour: reward.hour,
              syncCommittee: reward.syncCommittee,
              blockReward: 0n,
            },
            update: {
              syncCommittee: {
                increment: reward.syncCommittee,
              },
            },
          });
        }
      },
      {
        timeout: ms('5m'),
      },
    );
  }

  /**
   * Save block rewards to database
   */
  async saveBlockRewards(reward: {
    validatorIndex: number;
    date: Date;
    hour: number;
    blockReward: bigint;
  }) {
    return this.prisma.hourlyBlockAndSyncRewards.upsert({
      where: {
        validatorIndex_date_hour: {
          validatorIndex: reward.validatorIndex,
          date: reward.date,
          hour: reward.hour,
        },
      },
      create: {
        validatorIndex: reward.validatorIndex,
        date: reward.date,
        hour: reward.hour,
        blockReward: reward.blockReward,
        syncCommittee: 0n,
      },
      update: {
        blockReward: {
          increment: reward.blockReward,
        },
      },
    });
  }

  /**
   * Update committee attestation delays in batch
   */
  async updateCommitteeAttestationDelays(
    updates: Array<{
      slot: number;
      index: number;
      aggregationBitsIndex: number;
      attestationDelay: number;
    }>,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        const queries: Prisma.Sql[] = [];

        if (updates.length > 0) {
          const updateChunks = chunk(updates, 7000);
          for (const batchUpdates of updateChunks) {
            const updateQuery = Prisma.sql`
              UPDATE committee c
              SET attestation_delay = v.delay
              FROM (VALUES
                ${Prisma.join(
                  batchUpdates.map(
                    (u) =>
                      Prisma.sql`(${u.slot}, ${u.index}, ${u.aggregationBitsIndex}, ${u.attestationDelay})`,
                  ),
                )}
              ) AS v(slot, index, aggregation_bits_index, delay)
              WHERE c.slot = v.slot 
                AND c.index = v.index 
                AND c.aggregation_bits_index = v.aggregation_bits_index
                AND (c.attestation_delay IS NULL OR c.attestation_delay > v.delay);
            `;
            queries.push(updateQuery);
          }
        }

        // Execute all queries in parallel
        await Promise.all(queries.map((query) => tx.$executeRaw(query)));

        // Update slot processing data for the first slot in the batch
        if (updates.length > 0) {
          const firstSlot = updates[0].slot;
          await tx.slotProcessingData.upsert({
            where: { slot: firstSlot },
            update: { attestationsProcessed: true },
            create: {
              slot: firstSlot,
              attestationsProcessed: true,
            },
          });
        }
      },
      { timeout: ms('1m') },
    );
  }

  /**
   * Cleanup old committee data
   */
  async cleanupOldCommittees(slot: number, slotsPerEpoch: number, maxAttestationDelay: number) {
    return this.prisma.committee.deleteMany({
      where: {
        slot: {
          lt: slot - slotsPerEpoch * 3, // some buffer just in case
        },
        attestationDelay: {
          lte: maxAttestationDelay,
        },
      },
    });
  }

  /**
   * Find the first unprocessed slot in a range
   */
  async findMinUnprocessedSlotInEpoch(startSlot: number, endSlot: number) {
    const unprocessedSlot = await this.prisma.slot.findFirst({
      where: {
        slot: {
          gte: startSlot,
          lte: endSlot,
        },
        processed: false,
      },
      orderBy: {
        slot: 'asc',
      },
      select: {
        slot: true,
      },
    });

    return unprocessedSlot?.slot ?? null;
  }

  /**
   * Check if slot has all required processing completed
   */
  async isSlotFullyProcessed(slot: number) {
    const processingData = await this.prisma.slotProcessingData.findUnique({
      where: {
        slot: slot,
        attestationsProcessed: true,
        syncRewardsProcessed: true,
        blockRewardsProcessed: true,
      },
    });
    return processingData !== null;
  }

  /**
   * Get sync committee validators for an epoch
   */
  async getSyncCommitteeValidators(epoch: number) {
    const syncCommittee = await this.prisma.syncCommittee.findFirst({
      where: {
        fromEpoch: { lte: epoch },
        toEpoch: { gte: epoch },
      },
      select: {
        validators: true,
      },
    });

    return syncCommittee?.validators ?? [];
  }

  /**
   * Get committee validator amounts for specific slots
   */
  async getSlotCommitteesValidatorsAmountsForSlots(slots: number[]) {
    const committees = await this.prisma.committee.findMany({
      where: {
        slot: { in: slots },
      },
      select: {
        slot: true,
        index: true,
        aggregationBitsIndex: true,
      },
      orderBy: [{ slot: 'asc' }, { index: 'asc' }, { aggregationBitsIndex: 'asc' }],
    });

    // Group by slot and calculate validator amounts
    const result: Record<number, number[]> = {};
    for (const committee of committees) {
      if (!result[committee.slot]) {
        result[committee.slot] = [];
      }
      if (!result[committee.slot][committee.index]) {
        result[committee.slot][committee.index] = 0;
      }
      result[committee.slot][committee.index]++;
    }

    return result;
  }

  /**
   * Get validator balances for specific validators
   */
  async getValidatorsBalances(validatorIndexes: number[]) {
    return this.prisma.validator.findMany({
      where: {
        id: { in: validatorIndexes },
      },
      select: {
        id: true,
        balance: true,
      },
    });
  }

  /**
   * Save validator balances to database
   */
  async saveValidatorBalances(
    validatorBalances: Array<{ index: string; balance: string }>,
    slot: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Update validator balances
        for (const validator of validatorBalances) {
          await tx.validator.update({
            where: { id: parseInt(validator.index) },
            data: { balance: BigInt(validator.balance) },
          });
        }

        // Update slot processing data
        await tx.slotProcessingData.upsert({
          where: { slot },
          update: { attestationsProcessed: true },
          create: {
            slot,
            attestationsProcessed: true,
          },
        });
      },
      {
        timeout: ms('2m'),
      },
    );
  }

  /**
   * Process sync committee rewards and aggregate them into hourly validator data
   * Following the same pattern as epoch rewards processing
   */
  async processSyncCommitteeRewardsAndAggregate(
    slot: number,
    datetime: Date,
    processedRewards: Array<{
      validatorIndex: number;
      syncCommitteeReward: bigint;
      rewards: string; // Format: 'slot:reward'
    }>,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Process rewards in batches to avoid memory issues
        const batchSize = 50_000;
        const batches = chunk(processedRewards, batchSize);
        for (const batch of batches) {
          // Update HourlyValidatorData with pre-processed rewards string
          for (const processedReward of batch) {
            // Use raw SQL for proper string concatenation with CASE statement
            await tx.$executeRaw`
              INSERT INTO hourly_validator_data (datetime, validator_index, attestations, sync_committee_rewards, proposed_blocks_rewards, epoch_rewards)
              VALUES (${datetime}::timestamp, ${processedReward.validatorIndex}, '', CONCAT(${processedReward.rewards}, ','), '', '')
              ON CONFLICT (datetime, validator_index) DO UPDATE SET
                sync_committee_rewards = CONCAT(hourly_validator_data.sync_committee_rewards, EXCLUDED.sync_committee_rewards)
            `;
          }
        }

        // Aggregate rewards into HourlyValidatorStats using pre-calculated values
        // Process in batches to avoid SQL parameter limits
        const statsBatchSize = 5_000;
        const statsBatches = chunk(processedRewards, statsBatchSize);

        for (const statsBatch of statsBatches) {
          const valuesClause = statsBatch
            .map((r) => `(${r.validatorIndex}, ${r.syncCommitteeReward.toString()}, 0)`)
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
              cl_rewards = hourly_validator_stats.cl_rewards + EXCLUDED.cl_rewards
          `);
        }

        // mark slot as processed
        await tx.slotProcessingData.upsert({
          where: { slot },
          update: { syncRewardsProcessed: true },
          create: {
            slot,
            syncRewardsProcessed: true,
          },
        });
      },
      {
        timeout: ms('10s'),
      },
    );
  }

  /**
   * Process block rewards and aggregate them into hourly validator data
   * Following the same pattern as epoch rewards processing
   */
  async processBlockRewardsAndAggregate(
    slot: number,
    proposerIndex: number,
    datetime: Date,
    blockReward: bigint,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Update HourlyValidatorData with block reward
      const rewardsString = `${slot}:${blockReward.toString()}`;
      await tx.$executeRaw`
          INSERT INTO hourly_validator_data (datetime, validator_index, attestations, sync_committee_rewards, proposed_blocks_rewards, epoch_rewards)
          VALUES (${datetime}::timestamp, ${proposerIndex}, '', '', CONCAT(${rewardsString}, ','), '')
          ON CONFLICT (datetime, validator_index) DO UPDATE SET
            proposed_blocks_rewards = CONCAT(hourly_validator_data.proposed_blocks_rewards, EXCLUDED.proposed_blocks_rewards)
        `;

      // Aggregate rewards into HourlyValidatorStats
      await tx.$executeRaw`
          INSERT INTO hourly_validator_stats 
            (datetime, validator_index, cl_rewards, cl_missed_rewards)
          VALUES (${datetime}::timestamp, ${proposerIndex}, ${blockReward}, 0)
          ON CONFLICT (datetime, validator_index) DO UPDATE SET
            cl_rewards = hourly_validator_stats.cl_rewards + ${blockReward}
        `;

      // Mark slot as block rewards processed
      await tx.slotProcessingData.update({
        where: { slot },
        data: { blockRewardsProcessed: true },
      });

      // Update slot with proposer information
      await tx.slot.update({
        where: { slot },
        data: { proposedBy: proposerIndex },
      });
    });
  }

  /**
   * Get hourly validator data for specific validators and datetime
   */
  async getHourlyValidatorData(validatorIndexes: number[], datetime: Date) {
    return this.prisma.hourlyValidatorData.findMany({
      where: {
        validatorIndex: { in: validatorIndexes },
        datetime,
      },
      orderBy: [{ validatorIndex: 'asc' }],
    });
  }

  /**
   * Get hourly validator stats for specific validators and datetime
   */
  async getHourlyValidatorStats(validatorIndexes: number[], datetime: Date) {
    return this.prisma.hourlyValidatorStats.findMany({
      where: {
        validatorIndex: { in: validatorIndexes },
        datetime,
      },
      orderBy: [{ validatorIndex: 'asc' }],
    });
  }

  /**
   * Get a single hourly validator data record
   */
  async getHourlyValidatorDataForValidator(validatorIndex: number, datetime: Date) {
    return this.prisma.hourlyValidatorData.findFirst({
      where: {
        validatorIndex,
        datetime,
      },
    });
  }

  /**
   * Get a single hourly validator stats record
   */
  async getHourlyValidatorStatsForValidator(validatorIndex: number, datetime: Date) {
    return this.prisma.hourlyValidatorStats.findFirst({
      where: {
        validatorIndex,
        datetime,
      },
    });
  }

  /**
   * Test helper: Create initial hourly validator data for testing
   */
  async createTestHourlyValidatorData(data: Prisma.HourlyValidatorDataCreateInput) {
    return this.prisma.hourlyValidatorData.upsert({
      where: {
        datetime_validatorIndex: {
          datetime: data.datetime,
          validatorIndex: data.validatorIndex,
        },
      },
      update: {},
      create: data,
    });
  }

  /**
   * Test helper: Create initial hourly validator stats for testing
   */
  async createTestHourlyValidatorStats(data: Prisma.HourlyValidatorStatsCreateInput) {
    return this.prisma.hourlyValidatorStats.upsert({
      where: {
        datetime_validatorIndex: {
          datetime: data.datetime,
          validatorIndex: data.validatorIndex,
        },
      },
      update: {},
      create: data,
    });
  }

  /**
   * Test helper: Create slots for testing
   */
  async createTestSlots(data: Prisma.SlotCreateInput[]) {
    return this.prisma.slot.createMany({
      data: data,
      skipDuplicates: true,
    });
  }
}
