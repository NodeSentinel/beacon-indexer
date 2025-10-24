import { PrismaClient, Validator, Decimal, Prisma } from '@beacon-indexer/db';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';

export class ValidatorsStorage {
  constructor(private readonly prisma: PrismaClient) {}

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
   * Get max validator ID from database
   */
  async getMaxValidatorId() {
    const res = await this.prisma.validator.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return res?.id ?? 0;
  }

  /**
   * Get final state validator IDs from database
   */
  async getFinalValidatorIds() {
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
   * Get attesting validator IDs from database
   */
  async getAttestingValidatorsIds() {
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
   * Get validator balances for specific validator IDs
   */
  async getValidatorsBalances(validatorIds: number[]) {
    return this.prisma.validator.findMany({
      where: {
        id: { in: validatorIds },
      },
      select: { id: true, balance: true },
    });
  }

  /**
   * Get pending validators for tracking
   */
  async getPendingValidators(): Promise<Array<{ id: number }>> {
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
   */
  async saveValidatorBalances(
    validatorBalances: Array<{ index: string; balance: string }>,
    epoch: number,
  ) {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Create temporary table
          await tx.$executeRaw`
          CREATE TEMPORARY TABLE "TempValidator" (LIKE "Validator") ON COMMIT DROP
        `;

          const batches = chunk(validatorBalances, 12_000);
          for (const batch of batches) {
            await tx.$executeRaw`
            INSERT INTO "TempValidator" (id, balance)
            VALUES ${Prisma.join(
              batch.map(
                (data) =>
                  Prisma.sql`(
                    ${parseInt(data.index)}, 
                    ${new Decimal(data.balance)}
                  )`,
              ),
              ', ',
            )}
          `;
          }

          // Merge data from temporary table to main table
          await tx.$executeRaw`
            INSERT INTO "Validator" (id, balance)
            SELECT id, balance
            FROM "TempValidator"
            ON CONFLICT (id) DO UPDATE SET
              "balance" = EXCLUDED.balance
          `;

          // Update the epoch to mark balances as fetched
          await tx.epoch.update({
            where: { epoch },
            data: { validatorsBalancesFetched: true },
          });
        },
        {
          timeout: ms('1m'),
        },
      );
    } catch (error) {
      console.error(`Error saving validator balances to database`, error);
      throw error;
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
