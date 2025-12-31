import { Readable } from 'stream';

import { PrismaClient, Validator, Decimal, Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';
import { Pool } from 'pg';
// @ts-expect-error - pg-copy-streams doesn't have type definitions
import { from as copyFrom } from 'pg-copy-streams';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';

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
   * Update validators with new data
   */
  async updateValidators(
    validatorsData: Array<{
      index: string;
      status: string;
      balance: string;
      validator: {
        withdrawal_credentials: string;
        effective_balance: string;
      };
    }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const data of validatorsData) {
        const withdrawalAddress = data.validator.withdrawal_credentials.startsWith('0x')
          ? '0x' + data.validator.withdrawal_credentials.slice(-40)
          : null;

        await tx.validator.update({
          where: { id: +data.index },
          data: {
            withdrawalAddress,
            status: VALIDATOR_STATUS[data.status as keyof typeof VALIDATOR_STATUS],
            balance: BigInt(data.balance),
            effectiveBalance: BigInt(data.validator.effective_balance),
          },
        });
      }
    });
  }
}
