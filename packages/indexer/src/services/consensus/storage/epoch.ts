import { Readable } from 'stream';

import { PrismaClient, Committee, Prisma } from '@beacon-indexer/db';
import { Pool } from 'pg';
// @ts-expect-error - pg-copy-streams doesn't have type definitions
import { from as copyFrom } from 'pg-copy-streams';

/**
 * EpochStorage - Database persistence layer for epoch-related operations
 *
 * This class handles all database operations for epochs, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, data conversion, and processing happens in the controller layer.
 */
export class EpochStorage {
  private static pgPool: Pool | null = null;
  private readonly databaseUrl: string;

  constructor(
    private readonly prisma: PrismaClient,
    databaseUrl: string,
  ) {
    this.databaseUrl = databaseUrl;
  }

  /**
   * Get or create PostgreSQL connection pool for COPY operations
   * Uses a static pool that can be shared across instances
   * The pool manages multiple connections automatically for concurrent operations
   */
  private getPgPool(): Pool {
    if (!EpochStorage.pgPool) {
      EpochStorage.pgPool = new Pool({
        connectionString: this.databaseUrl,
        max: 10, // Allow up to 10 concurrent connections
      });
    }
    return EpochStorage.pgPool;
  }

  /**
   * Close the PostgreSQL connection pool
   * Should be called during cleanup (e.g., in test afterAll hooks)
   */
  static async closePgPool(): Promise<void> {
    if (EpochStorage.pgPool) {
      await EpochStorage.pgPool.end();
      EpochStorage.pgPool = null;
    }
  }

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

  /**
   * Get the minimum unprocessed epoch excluding the provided active epochs.
   * This is useful when processing multiple epochs in parallel to avoid duplicates.
   *
   * @param activeEpochs - Array of epoch numbers that are currently being processed
   * @returns The next epoch to process, or null if none available
   */
  async getMinEpochToProcessExcluding(activeEpochs: number[]) {
    const nextEpoch = await this.prisma.epoch.findFirst({
      where: {
        processed: false,
        epoch: {
          notIn: activeEpochs.length > 0 ? activeEpochs : undefined,
        },
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
   * Check if any unprocessed epoch before the given epoch has committeesFetched = false.
   * Only checks epochs >= lookbackEpoch to avoid blocking on epochs before the indexing start point.
   * Returns true if there are prior epochs missing committees data.
   */
  async hasPriorEpochsWithoutCommittees(epoch: number, lookbackEpoch: number): Promise<boolean> {
    const count = await this.prisma.epoch.count({
      where: {
        epoch: { lt: epoch, gte: lookbackEpoch },
        processed: false,
        committeesFetched: false,
      },
    });
    return count > 0;
  }

  /**
   * Check if any recent epoch before the given epoch has allSlotsProcessed = false.
   * Only looks back `epochsToCheckAmount` epochs, clamped to `lookbackEpoch` to avoid
   * blocking on epochs before the indexing start point.
   */
  async hasPriorEpochsWithoutSlotsProcessed(
    epoch: number,
    epochsToCheckAmount: number,
    lookbackEpoch: number,
  ): Promise<boolean> {
    const count = await this.prisma.epoch.count({
      where: {
        epoch: { lt: epoch, gte: Math.max(epoch - epochsToCheckAmount, lookbackEpoch) },
        allSlotsProcessed: false,
      },
    });
    return count > 0;
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
   * Process epoch rewards and store them in the database in a single atomic transaction.
   * Uses COPY FROM STDIN for maximum performance when inserting large amounts of data.
   *
   * @param epoch - The epoch number to process
   * @param processedRewards - Array of pre-processed reward data ready for storage
   */
  async processEpochRewardsAndAggregate(
    epoch: number,
    processedRewards: Array<{
      validatorIndex: number;
      head: bigint;
      target: bigint;
      source: bigint;
      inactivity: bigint;
      missedHead: bigint;
      missedTarget: bigint;
      missedSource: bigint;
      missedInactivity: bigint;
    }>,
  ) {
    const pool = this.getPgPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create temporary table using epoch_rewards as template
      // This ensures the structure is always in sync with the main table
      // No indexes or constraints are copied, which improves performance

      // Why use a temporary table instead of COPY directly to epoch_rewards?
      // - COPY to temp table generates NO WAL (much faster, no checkpoint triggers)
      // - Only the final INSERT SELECT generates WAL (just the final data)
      // - This significantly reduces WAL generation and checkpoint frequency
      // - The overhead of INSERT SELECT is minimal compared to WAL reduction benefits
      await client.query(`
        CREATE TEMPORARY TABLE tmp_epoch_rewards (LIKE epoch_rewards) ON COMMIT DROP;
      `);

      // Use COPY FROM STDIN for maximum performance
      // This is significantly faster than INSERT VALUES for large datasets
      const copyStream = client.query(
        copyFrom(`
          COPY tmp_epoch_rewards (epoch, validator_index, head, target, source, inactivity, missed_head, missed_target, missed_source, missed_inactivity)
          FROM STDIN WITH (FORMAT csv)
        `),
      );

      // Convert data to CSV format and stream to COPY
      const csvRows = processedRewards.map(
        (r) =>
          `${epoch},${r.validatorIndex},${r.head},${r.target},${r.source},${r.inactivity},${r.missedHead},${r.missedTarget},${r.missedSource},${r.missedInactivity}`,
      );

      const csvData = csvRows.join('\n');
      const readable = Readable.from(csvData);

      // Pipe CSV data to COPY stream
      await new Promise<void>((resolve, reject) => {
        readable.pipe(copyStream).on('finish', resolve).on('error', reject);
      });

      // Merge from temporary table to main table
      // If duplicates exist, PostgreSQL will throw a constraint violation error
      // This is the desired behavior - duplicates should not exist
      await client.query(`
        INSERT INTO epoch_rewards 
          (epoch, validator_index, head, target, source, inactivity, missed_head, missed_target, missed_source, missed_inactivity)
        SELECT 
          epoch, validator_index, head, target, source, inactivity, missed_head, missed_target, missed_source, missed_inactivity
        FROM tmp_epoch_rewards
      `);

      // Mark epoch as rewardsFetched = true
      await client.query('UPDATE epoch SET rewards_fetched = true WHERE epoch = $1', [epoch]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
   * Uses COPY FROM STDIN for maximum performance when inserting large amounts of data.
   */
  async saveCommitteesData(
    epoch: number,
    slots: number[],
    committees: Committee[],
    committeesCountInSlot: Map<number, number[]>,
  ) {
    const pool = this.getPgPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update slots with committee counts
      const slotsArray = slots;
      const committeesCountArray = slots.map((slot) =>
        JSON.stringify(committeesCountInSlot.get(slot) || []),
      );
      await client.query(
        `
        INSERT INTO "slot" (slot, processed, "committees_count_in_slot")
        SELECT 
          unnest($1::integer[]), 
          false,
          unnest($2::jsonb[])
        ON CONFLICT (slot) DO UPDATE SET
          "committees_count_in_slot" = EXCLUDED."committees_count_in_slot"
      `,
        [slotsArray, committeesCountArray],
      );

      // Insert committees using temporary table for better performance
      await client.query(`
        CREATE TEMPORARY TABLE tmp_committee (LIKE "committee") ON COMMIT DROP;
      `);

      // Use COPY FROM STDIN for maximum performance
      // This is significantly faster than INSERT VALUES for large datasets
      // Using NULL '' to specify empty string as NULL representation
      const copyStream = client.query(
        copyFrom(`
          COPY tmp_committee (slot, index, aggregation_bits_index, validator_index, attestation_delay)
          FROM STDIN WITH (FORMAT csv, NULL '')
        `),
      );

      // Convert data to CSV format and stream to COPY
      // Using empty string for NULL values (specified in COPY command above)
      const csvRows = committees.map((c) => {
        const delay = c.attestationDelay === null ? '' : c.attestationDelay;
        return `${c.slot},${c.index},${c.aggregationBitsIndex},${c.validatorIndex},${delay}`;
      });

      const csvData = csvRows.join('\n');
      const readable = Readable.from(csvData);

      // Pipe CSV data to COPY stream
      await new Promise<void>((resolve, reject) => {
        readable.pipe(copyStream).on('finish', resolve).on('error', reject);
      });

      // Copy all data from temporary table to Committee table in one operation
      await client.query(`
        INSERT INTO "committee" (slot, index, "aggregation_bits_index", "validator_index", "attestation_delay")
        SELECT slot, index, "aggregation_bits_index", "validator_index", "attestation_delay"
        FROM tmp_committee;
      `);

      // Update epoch status
      await client.query('UPDATE epoch SET committees_fetched = true WHERE epoch = $1', [epoch]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
      await tx.syncCommittee.createMany({
        data: {
          fromEpoch,
          toEpoch,
          validators: syncCommitteeData.validators,
          validatorAggregates: syncCommitteeData.validator_aggregates,
        },
        // Multiple epoch workers can race to insert the same sync committee period.
        // If another worker won first, treat it as success and still mark this epoch as done.
        skipDuplicates: true,
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
