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
        slotProcessedData: true,
      },
    });
  }

  /**
   * Get slot by number without processing data
   */
  async getSlotWithoutProcessedData(slot: number) {
    return this.prisma.slot.findFirst({
      where: {
        slot: slot,
      },
    });
  }

  /**
   * Check if sync committee data exists for a given slot
   */
  async isSyncCommitteeFetchedForSlot(slot: number) {
    const res = await this.prisma.slot.findFirst({
      where: { slot: slot },
      select: {
        syncRewardsFetched: true,
      },
    });

    return res?.syncRewardsFetched === true;
  }

  /**
   * Check if block rewards data exists for a given slot
   */
  async isBlockRewardsFetchedForSlot(slot: number) {
    const res = await this.prisma.slot.findFirst({
      where: { slot: slot },
      select: { blockRewardsFetched: true },
    });

    return res?.blockRewardsFetched === true;
  }

  async areAttestationsProcessedForSlot(slot: number) {
    const res = await this.prisma.slot.findFirst({
      where: { slot: slot },
      select: { attestationsFetched: true },
    });

    return res?.attestationsFetched === true;
  }

  /**
   * Get hourly validator data for specific validators and datetime
   */
  async getHourlyValidatorData(validatorIndexes: number[], datetime: Date) {
    return this.prisma.hourlyValidatorStats.findMany({
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
    return this.prisma.hourlyValidatorStats.findFirst({
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
    const processingData = await this.prisma.slot.findUnique({
      where: {
        slot: slot,
        attestationsFetched: true,
        syncRewardsFetched: true,
        blockRewardsFetched: true,
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
   * Return committee sizes per slot
   *
   * For each input slot, returns a map `{ slot: number[] }` where the index in the
   * array equals the `committeeIndex` for that slot. That is, `array[0]` is the size
   * of slot.index 0, `array[1]` is the size of slot.index 1, and so on. The value at
   * each position is the number of validators in that committee.
   * Example: `{ 12345: [350, 349, ...] }` means slot 12345 has committee 0 with 350
   * validators, committee 1 with 349 validators, etc.
   */
  async getCommitteeSizesForSlots(slots: number[]): Promise<Record<number, number[]>> {
    if (slots.length === 0) {
      return {};
    }

    const slotData = await this.prisma.slot.findMany({
      where: {
        slot: { in: slots },
      },
      select: {
        slot: true,
        committeesCountInSlot: true,
      },
    });

    // Build result map from pre-calculated data
    const result: Record<number, number[]> = {};
    for (const slot of slotData) {
      if (slot.committeesCountInSlot) {
        result[slot.slot] = slot.committeesCountInSlot as number[];
      }
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
   * Update slot processing data
   */
  async updateSlotProcessedData(slot: number, data: Prisma.SlotProcessedDataUpdateInput) {
    return this.prisma.slotProcessedData.update({
      where: { slot },
      data,
    });
  }

  /**
   * Generic update for slot flags
   */
  async updateSlotFlags(
    slot: number,
    data: Pick<
      Prisma.SlotUpdateInput,
      | 'attestationsFetched'
      | 'syncRewardsFetched'
      | 'blockRewardsFetched'
      | 'executionRewardsFetched'
    >,
  ) {
    return this.prisma.slot.update({
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
    return this.prisma.slot.update({
      where: { slot: slot },
      data: { attestationsFetched: true },
    });
  }

  /**
   * Update block and sync rewards processed status
   */
  async updateBlockAndSyncRewardsProcessed(slot: number) {
    return this.prisma.slot.upsert({
      where: { slot },
      update: {
        syncRewardsFetched: true,
        blockRewardsFetched: true,
      },
      create: {
        slot,
        syncRewardsFetched: true,
        blockRewardsFetched: true,
      },
    });
  }

  /**
   * Update execution rewards processed status
   */
  async updateExecutionRewardsProcessed(slot: number) {
    return this.prisma.slot.update({
      where: {
        slot: slot,
      },
      data: {
        executionRewardsFetched: true,
      },
    });
  }

  /**
   * Update slot with beacon data (withdrawals, deposits, etc.)
   */
  async updateSlotWithBeaconData(
    slot: number,
    data: Pick<
      Prisma.SlotProcessedDataUpdateInput,
      | 'withdrawalsRewards'
      | 'clDeposits'
      | 'clVoluntaryExits'
      | 'elDeposits'
      | 'elWithdrawals'
      | 'elConsolidations'
    >,
  ) {
    return this.prisma.slotProcessedData.update({
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

  async saveSlotAttestations(
    attestations: Prisma.CommitteeUpdateInput[],
    slotNumber: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const queries: Prisma.Sql[] = [];

        // Process updates
        if (attestations.length > 0) {
          const updateChunks = chunk(attestations, 20_000);
          for (const batchUpdates of updateChunks) {
            const updateQuery = Prisma.sql`
            UPDATE "Committee" c
            SET "attestationDelay" = v.delay
            FROM (VALUES
              ${Prisma.join(
                batchUpdates.map(
                  (u) =>
                    Prisma.sql`(${u.slot}, ${u.index}, ${u.aggregationBitsIndex}, ${u.attestationDelay})`,
                ),
              )}
            ) AS v(slot, index, "aggregationBitsIndex", delay)
            WHERE c.slot = v.slot 
              AND c.index = v.index 
              AND c."aggregationBitsIndex" = v."aggregationBitsIndex"
              AND (c."attestationDelay" IS NULL OR c."attestationDelay" > v.delay);
          `;
            queries.push(updateQuery);
          }
        }

        for (const query of queries) {
          await tx.$executeRaw(query);
        }

        // Update slot processing data
        await tx.slot.upsert({
          where: { slot: slotNumber },
          update: { attestationsFetched: true },
          create: {
            slot: slotNumber,
            attestationsFetched: true,
          },
        });
      },
      { timeout: ms('1m') },
    );
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
          await tx.slot.upsert({
            where: { slot: firstSlot },
            update: { attestationsFetched: true },
            create: {
              slot: firstSlot,
              attestationsFetched: true,
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
        await tx.slot.upsert({
          where: { slot },
          update: { attestationsFetched: true },
          create: {
            slot,
            attestationsFetched: true,
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
        // Save sync committee rewards to syncCommitteeRewards table
        // Process rewards in batches to avoid memory issues
        const batchSize = 50_000;
        const batches = chunk(processedRewards, batchSize);
        for (const batch of batches) {
          for (const processedReward of batch) {
            await tx.syncCommitteeRewards.upsert({
              where: {
                slot_validatorIndex: {
                  slot,
                  validatorIndex: processedReward.validatorIndex,
                },
              },
              create: {
                slot,
                validatorIndex: processedReward.validatorIndex,
                syncCommitteeReward: processedReward.syncCommitteeReward,
              },
              update: {
                syncCommitteeReward: processedReward.syncCommitteeReward,
              },
            });
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
        await tx.slot.upsert({
          where: { slot },
          update: { syncRewardsFetched: true },
          create: {
            slot,
            syncRewardsFetched: true,
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
      // Save block reward to Slot table (consensusReward and proposerIndex)
      await tx.slot.update({
        where: { slot },
        data: {
          proposerIndex,
          consensusReward: blockReward,
          blockRewardsFetched: true,
        },
      });

      // Aggregate rewards into HourlyValidatorStats
      await tx.$executeRaw`
          INSERT INTO hourly_validator_stats 
            (datetime, validator_index, cl_rewards, cl_missed_rewards)
          VALUES (${datetime}::timestamp, ${proposerIndex}, ${blockReward}, 0)
          ON CONFLICT (datetime, validator_index) DO UPDATE SET
            cl_rewards = hourly_validator_stats.cl_rewards + ${blockReward}
        `;
    });
  }

  /**
   * Test helper: Create initial hourly validator data for testing
   */
  // async createTestHourlyValidatorData(data: Prisma.HourlyValidatorDataCreateInput) {
  //   return this.prisma.hourlyValidatorData.upsert({
  //     where: {
  //       datetime_validatorIndex: {
  //         datetime: data.datetime,
  //         validatorIndex: data.validatorIndex,
  //       },
  //     },
  //     update: {},
  //     create: data,
  //   });
  // }

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

  /**
   * Get sync committee rewards for a validator in a specific datetime (hour)
   * Returns all rewards for the validator in that hour
   */
  async getSyncCommitteeRewardsForValidator(validatorIndex: number, datetime: Date) {
    // Extract hour from datetime
    const hour = datetime.getUTCHours();
    const date = new Date(
      Date.UTC(datetime.getUTCFullYear(), datetime.getUTCMonth(), datetime.getUTCDate()),
    );

    // Get all slots in that hour by checking slot timestamps
    // We need to find slots that fall within the hour window
    const startOfHour = new Date(datetime);
    startOfHour.setUTCMinutes(0);
    startOfHour.setUTCSeconds(0);
    startOfHour.setUTCMilliseconds(0);
    const endOfHour = new Date(startOfHour);
    endOfHour.setUTCHours(endOfHour.getUTCHours() + 1);

    // Get all sync committee rewards for this validator in slots within the hour
    // Note: This requires calculating which slots fall in the hour based on genesis timestamp
    // For now, we'll query by getting all rewards for the validator and filtering by slot
    // This is a simplified approach - in production you'd calculate slot ranges from datetime
    return this.prisma.syncCommitteeRewards.findMany({
      where: {
        validatorIndex,
        // Note: We would need slot timestamps to filter properly by hour
        // This is a placeholder - actual implementation would need slot time calculation
      },
      orderBy: {
        slot: 'asc',
      },
    });
  }

  /**
   * Get sync committee rewards for a validator in slots within a datetime range
   * This is a helper method that takes slot numbers directly
   */
  async getSyncCommitteeRewardsForValidatorInSlots(validatorIndex: number, slots: number[]) {
    if (slots.length === 0) {
      return [];
    }

    return this.prisma.syncCommitteeRewards.findMany({
      where: {
        validatorIndex,
        slot: {
          in: slots,
        },
      },
      orderBy: {
        slot: 'asc',
      },
    });
  }
}
