import { Readable } from 'stream';

import { VALIDATOR_STATUS } from '@beacon-indexer/beacon-utils';
import { PrismaClient, Validator } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';
import { Pool, PoolClient } from 'pg';
// @ts-expect-error - pg-copy-streams doesn't have type definitions
import { from as copyFrom } from 'pg-copy-streams';

import { ValidatorControllerHelpers } from '../controllers/helpers/validatorControllerHelpers.js';

import type { GetValidators } from '../types.js';

export class ValidatorsStorage {
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
    if (!ValidatorsStorage.pgPool) {
      ValidatorsStorage.pgPool = new Pool({
        connectionString: this.databaseUrl,
        max: 10, // Allow up to 10 concurrent connections
      });
    }
    return ValidatorsStorage.pgPool;
  }

  /**
   * Close the PostgreSQL connection pool
   * Should be called during cleanup (e.g., in test afterAll hooks)
   */
  static async closePgPool(): Promise<void> {
    if (ValidatorsStorage.pgPool) {
      await ValidatorsStorage.pgPool.end();
      ValidatorsStorage.pgPool = null;
    }
  }

  /**
   * Maps one Beacon API validator payload to the database row shape.
   */
  private mapValidatorStateRow(validatorData: GetValidators['data'][number]) {
    return {
      id: +validatorData.index,
      status: VALIDATOR_STATUS[validatorData.status as keyof typeof VALIDATOR_STATUS],
      balance: validatorData.balance,
      effectiveBalance: validatorData.validator.effective_balance,
      withdrawalAddress: validatorData.validator.withdrawal_credentials.startsWith('0x')
        ? '0x' + validatorData.validator.withdrawal_credentials.slice(-40)
        : null,
      withdrawalCredentialsPrefix: validatorData.validator.withdrawal_credentials.slice(0, 4),
      activationEpoch: ValidatorControllerHelpers.parseEpoch(
        validatorData.validator.activation_epoch,
      ),
    };
  }

  /**
   * Serializes validator rows into CSV lines for COPY.
   */
  private buildValidatorStateCsvRows(validatorsData: GetValidators['data']): string[] {
    return validatorsData.map((data) => {
      const row = this.mapValidatorStateRow(data);
      return [
        row.id,
        row.status,
        row.balance,
        row.effectiveBalance,
        row.withdrawalAddress ?? '',
        row.withdrawalCredentialsPrefix,
        row.activationEpoch ?? '',
      ].join(',');
    });
  }

  /**
   * Upserts validator state in one set-based SQL pass.
   */
  private async copyValidatorStateRows(
    client: PoolClient,
    validatorsData: GetValidators['data'],
  ): Promise<void> {
    if (validatorsData.length === 0) {
      return;
    }

    // Stores the current validator state batch before merging into the main table.
    await client.query(`
      CREATE TEMPORARY TABLE tmp_validator_state (
        id INTEGER,
        status INTEGER,
        balance BIGINT,
        effective_balance BIGINT,
        withdrawal_address VARCHAR(42),
        withdrawal_credentials_prefix CHAR(4),
        activation_epoch INTEGER
      ) ON COMMIT DROP;
    `);

    // Streams the validator batch into PostgreSQL to avoid one statement per validator.
    const copyStream = client.query(
      copyFrom(`
        COPY tmp_validator_state (
          id,
          status,
          balance,
          effective_balance,
          withdrawal_address,
          withdrawal_credentials_prefix,
          activation_epoch
        )
        FROM STDIN WITH (FORMAT csv, NULL '')
      `),
    );

    const csvData = this.buildValidatorStateCsvRows(validatorsData).join('\n');
    const readable = Readable.from(csvData);

    // Pipes the serialized validator rows into the temp table.
    await new Promise<void>((resolve, reject) => {
      readable.pipe(copyStream).on('finish', resolve).on('error', reject);
    });
  }

  /**
   * Upserts validator state from the temporary table in one SQL statement.
   */
  private async mergeCopiedValidatorState(client: PoolClient): Promise<void> {
    // Merges the temp table into validator with one upsert statement.
    await client.query(`
      INSERT INTO validator (
        id,
        status,
        balance,
        effective_balance,
        withdrawal_address,
        withdrawal_credentials_prefix,
        activation_epoch
      )
      SELECT
        id,
        status,
        balance,
        effective_balance,
        withdrawal_address,
        withdrawal_credentials_prefix,
        activation_epoch
      FROM tmp_validator_state
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        balance = EXCLUDED.balance,
        effective_balance = EXCLUDED.effective_balance,
        withdrawal_address = EXCLUDED.withdrawal_address,
        withdrawal_credentials_prefix = EXCLUDED.withdrawal_credentials_prefix,
        activation_epoch = EXCLUDED.activation_epoch
    `);
  }

  /**
   * Upserts validator state in one set-based SQL pass.
   */
  private async upsertValidatorState(validatorsData: GetValidators['data']): Promise<void> {
    if (validatorsData.length === 0) {
      return;
    }

    const pool = this.getPgPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await this.copyValidatorStateRows(client, validatorsData);
      await this.mergeCopiedValidatorState(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getValidatorsCount() {
    return this.prisma.validator.count();
  }

  async saveValidators(validators: Validator[]) {
    const batches = chunk(validators, 10000);

    for (const batch of batches) {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.validator.createMany({
            data: batch,
            skipDuplicates: true,
          });
        },
        {
          timeout: ms('2m'),
        },
      );
    }
  }

  async getValidatorById(id: number) {
    return this.prisma.validator.findUnique({
      where: { id },
    });
  }

  /**
   * Get max validator index from database
   */
  async getMaxValidatorIndex() {
    const res = await this.prisma.validator.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return res?.id ?? 0;
  }

  /**
   * Get final state validator indices from database
   */
  async getFinalValidatorIndexes() {
    const finalStateValidators = await this.prisma.validator.findMany({
      where: {
        status: {
          in: [
            VALIDATOR_STATUS.exited_unslashed,
            VALIDATOR_STATUS.exited_slashed,
            VALIDATOR_STATUS.withdrawal_done,
          ],
        },
      },
      select: { id: true },
    });
    return finalStateValidators.map((v) => v.id);
  }

  /**
   * Get attesting validator indices from database
   */
  async getAttestingValidatorIndexes() {
    const validators = await this.prisma.validator.findMany({
      where: {
        OR: [
          {
            status: {
              in: [
                VALIDATOR_STATUS.active_ongoing,
                VALIDATOR_STATUS.active_exiting,
                VALIDATOR_STATUS.active_slashed,
              ],
            },
          },
          {
            status: null,
          },
        ],
      },
      select: { id: true },
    });
    return validators.map((v) => v.id);
  }

  /**
   * Get validator balances for specific validator indices
   */
  async getValidatorsBalances(validatorIndexes: number[]) {
    return this.prisma.validator.findMany({
      where: {
        id: { in: validatorIndexes },
      },
      select: { id: true, balance: true },
    });
  }

  /**
   * Get pending validators for tracking
   */
  async getPendingValidators() {
    return this.prisma.validator.findMany({
      where: {
        status: {
          in: [VALIDATOR_STATUS.pending_initialized, VALIDATOR_STATUS.pending_queued],
        },
      },
      select: { id: true },
    });
  }

  /**
   * Save validator balances to database
   * Uses COPY FROM STDIN for maximum performance when inserting large amounts of data.
   */
  async saveValidatorBalances(
    validatorBalances: Array<{ index: string; balance: string }>,
    epoch: number,
  ) {
    const pool = this.getPgPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create temporary table
      await client.query(`
        CREATE TEMPORARY TABLE tmp_validator (LIKE validator) ON COMMIT DROP;
      `);

      // Use COPY FROM STDIN for maximum performance
      // This is significantly faster than INSERT VALUES for large datasets
      const copyStream = client.query(
        copyFrom(`
          COPY tmp_validator (id, balance)
          FROM STDIN WITH (FORMAT csv)
        `),
      );

      // Convert data to CSV format and stream to COPY
      const csvRows = validatorBalances.map((data) => {
        const id = parseInt(data.index);
        const balance = data.balance;
        return `${id},${balance}`;
      });

      const csvData = csvRows.join('\n');
      const readable = Readable.from(csvData);

      // Pipe CSV data to COPY stream
      await new Promise<void>((resolve, reject) => {
        readable.pipe(copyStream).on('finish', resolve).on('error', reject);
      });

      // Merge data from temporary table to main table
      await client.query(`
        INSERT INTO validator (id, balance)
        SELECT id, balance
        FROM tmp_validator
        ON CONFLICT (id) DO UPDATE SET
          balance = EXCLUDED.balance
      `);

      // Update the epoch to mark balances as fetched
      await client.query('UPDATE epoch SET validators_balances_fetched = true WHERE epoch = $1', [
        epoch,
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Save the full validator state for a processed epoch.
   * Updates validator fields and marks the epoch snapshot as fetched.
   */
  async saveValidatorsForEpoch(
    validatorsData: GetValidators['data'],
    epoch: number,
  ): Promise<void> {
    const pool = this.getPgPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Updates validator state first so the epoch flag only flips after the write succeeds.
      if (validatorsData.length > 0) {
        await this.copyValidatorStateRows(client, validatorsData);
        await this.mergeCopiedValidatorState(client);
      }

      // Marks the epoch batch as fetched within the same transaction.
      await client.query('UPDATE epoch SET validators_balances_fetched = true WHERE epoch = $1', [
        epoch,
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update validators with new data
   */
  async updateValidators(validatorsData: GetValidators['data']): Promise<void> {
    await this.upsertValidatorState(validatorsData);
  }
}
