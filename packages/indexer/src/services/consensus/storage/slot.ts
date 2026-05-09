import { Prisma, PrismaClient } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import { LRUCache } from 'lru-cache';
import ms from 'ms';

/**
 * SlotStorage - Database persistence layer for slot-related operations
 *
 * This class handles all database operations for slots, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, data conversion, and processing happens in the controller layer.
 */
export class SlotStorage {
  private readonly syncCommitteeValidatorsCache = new LRUCache<number, string[]>({
    max: 3,
    ttl: ms('1h'),
    fetchMethod: (epoch) => this.fetchSyncCommitteeValidators(epoch),
  });

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get slot by number with processing data
   */
  async getSlot(slot: number) {
    return this.prisma.slot.findFirst({
      where: {
        slot: slot,
      },
    });
  }

  /**
   * Get slot by number without processing data
   */
  async getBaseSlot(slot: number) {
    return this.prisma.slot.findFirstOrThrow({
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
  async areSlotConsensusRewardsFetched(slotNumber: number) {
    const slot = await this.prisma.slot.findFirstOrThrow({
      where: { slot: slotNumber },
      select: {
        slot: true,
        consensusRewardsFetched: true,
      },
    });

    return slot.consensusRewardsFetched === true;
  }

  async areAttestationsProcessedForSlot(slot: number) {
    const res = await this.prisma.slot.findFirst({
      where: { slot: slot },
      select: { attestationsFetched: true },
    });

    return res?.attestationsFetched === true;
  }

  /**
   * Check if execution rewards have been fetched for a slot
   */
  async areExecutionRewardsFetched(slot: number) {
    const res = await this.prisma.slot.findFirst({
      where: { slot },
      select: { executionRewardsFetched: true },
    });

    return res?.executionRewardsFetched === true;
  }

  /**
   * Get the last processed slot number
   */
  async getLastProcessedSlot(): Promise<number | null> {
    const result = await this.prisma.slot.findFirst({
      where: { processed: true },
      orderBy: { slot: 'desc' },
      select: { slot: true },
    });

    return result?.slot ?? null;
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
   * Get the slot processing status for an epoch range.
   * Returns the next unprocessed slot (if any) and whether all slots are processed.
   */
  async getEpochSlotsStatus(startSlot: number, endSlot: number) {
    // Single query to get all slots in the range
    const slots = await this.prisma.slot.findMany({
      where: {
        slot: {
          gte: startSlot,
          lte: endSlot,
        },
      },
      select: {
        slot: true,
        processed: true,
      },
      orderBy: {
        slot: 'asc',
      },
    });

    const expectedSlotCount = endSlot - startSlot + 1;
    const totalSlots = slots.length;
    const processedSlots = slots.filter((s) => s.processed).length;

    // Find first unprocessed slot
    const firstUnprocessed = slots.find((s) => !s.processed);

    return {
      nextSlotToProcess: firstUnprocessed?.slot ?? null,
      // All slots are processed only if:
      // 1. We have all the expected slots in the DB
      // 2. All of them are marked as processed
      allSlotsProcessed: totalSlots === expectedSlotCount && processedSlots === expectedSlotCount,
    };
  }

  /**
   * Fetch sync committee validators for an epoch from storage.
   */
  private async fetchSyncCommitteeValidators(epoch: number) {
    const syncCommittee = await this.prisma.syncCommittee.findFirst({
      where: {
        fromEpoch: { lte: epoch },
        toEpoch: { gte: epoch },
      },
      select: {
        validators: true,
      },
    });

    return (syncCommittee?.validators as string[] | undefined) ?? [];
  }

  /**
   * Get sync committee validators for an epoch.
   */
  async getSyncCommitteeValidators(epoch: number) {
    return (await this.syncCommitteeValidatorsCache.fetch(epoch)) ?? [];
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
   * Generic update for slot flags
   */
  async updateSlotFlags(
    slot: number,
    data: Partial<
      Pick<
        Prisma.SlotUpdateInput,
        | 'attestationsFetched'
        | 'consensusRewardsFetched'
        | 'executionRewardsFetched'
        | 'epWithdrawalsFetched'
        | 'syncRewardsFetched'
        | 'depositsFetched'
        | 'voluntaryExitsFetched'
        | 'erDepositsFetched'
        | 'erWithdrawalsFetched'
        | 'erConsolidationsFetched'
        | 'proposerSlashingsFetched'
        | 'attesterSlashingsFetched'
      >
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

  async saveSlotAttestations(
    attestations: Prisma.CommitteeUpdateInput[],
    slotNumber: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const queries: Prisma.Sql[] = [];

        // Process updates
        if (attestations.length > 0) {
          // Use 7000 chunks to avoid exceeding PostgreSQL's 32767 bind variables limit
          // Each attestation generates 4 bind variables (slot, index, aggregationBitsIndex, delay)
          // 7000 * 4 = 28000 < 32767
          const updateChunks = chunk(attestations, 7000);
          for (const batchUpdates of updateChunks) {
            const updateQuery = Prisma.sql`
            UPDATE "committee" c
            SET "attestation_delay" = v.delay
            FROM (VALUES
              ${Prisma.join(
                batchUpdates.map(
                  (u) =>
                    Prisma.sql`(${u.slot}, ${u.index}, ${u.aggregationBitsIndex}, ${u.attestationDelay})`,
                ),
              )}
            ) AS v(slot, index, "aggregation_bits_index", delay)
            WHERE c.slot = v.slot 
              AND c.index = v.index 
              AND c."aggregation_bits_index" = v."aggregation_bits_index"
              AND (c."attestation_delay" IS NULL OR c."attestation_delay" > v.delay);
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
      { timeout: ms('3m') },
    );
  }

  /**
   * Save execution rewards directly to slot table
   * Updates the slot with executionReward, feeRecipientAddress, and blockNumber
   */
  async saveExecutionRewardsAndUpdateSlot(
    slot: number,
    executionReward: string,
    feeRecipientAddress: string,
    blockNumber: number,
  ) {
    await this.prisma.slot.update({
      where: { slot },
      data: {
        executionRewardsFetched: true,
        executionReward,
        feeRecipientAddress,
        blockNumber,
      },
    });
  }

  /**
   * Save block rewards and update slot flag in a transaction
   */
  async saveBlockRewards(
    slot: number,
    reward: {
      validatorIndex: number;
      blockReward: bigint;
    } | null,
  ) {
    if (!reward) {
      throw new Error('Block reward is required');
    }

    await this.prisma.slot.update({
      where: { slot },
      data: {
        consensusRewardsFetched: true,
        proposerIndex: reward.validatorIndex,
        consensusReward: reward.blockReward,
      },
    });
  }

  /**
   * Save sync committee rewards and update slot flag in a transaction
   * Now stores rewards per slot instead of per hour
   */
  async saveSyncRewards(
    slot: number,
    rewards: Array<{
      validatorIndex: number;
      syncCommitteeReward: bigint;
    }>,
  ) {
    if (rewards.length === 0) {
      throw new Error('Sync committee rewards are required');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.validatorSyncRewards.createMany({
        data: rewards.map((reward) => ({
          slot,
          validatorIndex: reward.validatorIndex,
          syncCommittee: reward.syncCommitteeReward,
        })),
      });

      await tx.slot.update({
        where: { slot },
        data: { syncRewardsFetched: true },
      });
    });
  }

  /**
   * Save validator withdrawals to database
   */
  async saveValidatorWithdrawals(
    slot: number,
    withdrawals: Prisma.validatorWithdrawalsUncheckedCreateInput[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorWithdrawals.createMany({
        data: withdrawals,
      });
      await tx.slot.update({
        where: { slot },
        data: { epWithdrawalsFetched: true },
      });
    });
  }

  /**
   * Save validator deposits from execution requests to database
   */
  async saveValidatorDeposits(
    slot: number,
    deposits: Prisma.validatorDepositsUncheckedCreateInput[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorDeposits.createMany({
        data: deposits,
      });
      await tx.slot.update({
        where: { slot },
        data: { erDepositsFetched: true },
      });
    });
  }

  /**
   * Save validator deposits from beacon block body to database
   */
  async saveBodyDeposits(slot: number, deposits: Prisma.validatorDepositsUncheckedCreateInput[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorDeposits.createMany({
        data: deposits,
      });
      await tx.slot.update({
        where: { slot },
        data: { depositsFetched: true },
      });
    });
  }

  /**
   * Save validator exits to database
   */
  async saveValidatorExits(slot: number, exits: Prisma.validatorExitsUncheckedCreateInput[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorExits.createMany({
        data: exits,
      });
      await tx.slot.update({
        where: { slot },
        data: { voluntaryExitsFetched: true },
      });
    });
  }

  /**
   * Save validator withdrawal requests to database
   */
  async saveValidatorWithdrawalsRequests(
    slot: number,
    withdrawals: Prisma.validatorWithdrawalsRequestsUncheckedCreateInput[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorWithdrawalsRequests.createMany({
        data: withdrawals,
      });
      await tx.slot.update({
        where: { slot },
        data: { erWithdrawalsFetched: true },
      });
    });
  }

  /**
   * Save validator consolidation requests to database
   */
  async saveValidatorConsolidationsRequests(
    slot: number,
    consolidations: Prisma.validatorConsolidationsRequestsUncheckedCreateInput[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.validatorConsolidationsRequests.createMany({
        data: consolidations,
      });
      await tx.slot.update({
        where: { slot },
        data: { erConsolidationsFetched: true },
      });
    });
  }

  async saveExecutionRequests(
    slotNumber: number,
    data: {
      validatorDeposits: Prisma.validatorDepositsUncheckedCreateInput[];
      validatorWithdrawalsRequests: Prisma.validatorWithdrawalsRequestsUncheckedCreateInput[];
      validatorConsolidationsRequests: Prisma.validatorConsolidationsRequestsUncheckedCreateInput[];
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (data.validatorDeposits.length > 0) {
        await tx.validatorDeposits.createMany({
          data: data.validatorDeposits,
        });
      }
      if (data.validatorWithdrawalsRequests.length > 0) {
        await tx.validatorWithdrawalsRequests.createMany({
          data: data.validatorWithdrawalsRequests,
        });
      }
      if (data.validatorConsolidationsRequests.length > 0) {
        await tx.validatorConsolidationsRequests.createMany({
          data: data.validatorConsolidationsRequests,
        });
      }
      await tx.slot.update({
        where: { slot: slotNumber },
        data: {
          erDepositsFetched: data.validatorDeposits.length > 0,
          erWithdrawalsFetched: data.validatorWithdrawalsRequests.length > 0,
          erConsolidationsFetched: data.validatorConsolidationsRequests.length > 0,
        },
      });
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
   * Test helper: Create slots for testing
   */
  async createTestSlots(data: Prisma.SlotCreateInput[]) {
    return this.prisma.slot.createMany({
      data: data,
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

    return this.prisma.validatorSyncRewards.findMany({
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

  /**
   * Get block reward for a specific slot and validator
   * Reads from slot table where proposerIndex matches
   */
  async getBlockRewardForSlot(slot: number, validatorIndex: number) {
    const slotData = await this.prisma.slot.findFirst({
      where: {
        slot,
        proposerIndex: validatorIndex,
      },
      select: {
        slot: true,
        consensusReward: true,
      },
    });

    if (!slotData || slotData.consensusReward === null) {
      return null;
    }

    return {
      slot: slotData.slot,
      validatorIndex,
      blockReward: slotData.consensusReward,
    };
  }

  /**
   * Get validator withdrawals for a slot
   */
  async getValidatorWithdrawalsForSlot(slot: number) {
    return this.prisma.validatorWithdrawals.findMany({
      where: { slot },
      orderBy: { withdrawalIndex: 'asc' },
    });
  }

  /**
   * Get validator deposits for a slot
   */
  async getValidatorDepositsForSlot(slot: number) {
    return this.prisma.validatorDeposits.findMany({
      where: { slot },
      orderBy: { pubkey: 'asc' },
    });
  }

  /**
   * Get validator withdrawal requests for a slot
   */
  async getValidatorWithdrawalsRequestsForSlot(slot: number) {
    return this.prisma.validatorWithdrawalsRequests.findMany({
      where: { slot },
      orderBy: { requestIndex: 'asc' },
    });
  }

  /**
   * Get validator consolidation requests for a slot
   */
  async getValidatorConsolidationsRequestsForSlot(slot: number) {
    return this.prisma.validatorConsolidationsRequests.findMany({
      where: { slot },
    });
  }
}
