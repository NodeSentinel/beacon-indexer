import { Prisma, PrismaClient } from '@beacon-indexer/db';

export type ClaimableWithdrawalAmount = {
  withdrawalAddress: string;
  amountWei: bigint;
};

/**
 * ClaimableWithdrawalsStorage owns database reads and writes for withdrawal-address claimable snapshots.
 */
export class ClaimableWithdrawalsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists distinct withdrawal addresses currently tracked by at least one cluster validator.
   */
  async listTrackedWithdrawalAddresses(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ withdrawal_address: string }>>(Prisma.sql`
      SELECT DISTINCT LOWER(v.withdrawal_address) AS withdrawal_address
      FROM cluster_validator cv
      JOIN validator v ON v.id = cv.validator_index
      WHERE v.withdrawal_address IS NOT NULL
    `);

    return rows.map((row) => row.withdrawal_address);
  }

  /**
   * Upserts raw contract amounts for withdrawal addresses read from the Gnosis deposit contract.
   */
  async upsertClaimableAmounts(amounts: ClaimableWithdrawalAmount[]): Promise<void> {
    if (amounts.length === 0) return;

    const values = amounts.map((amount) => {
      return Prisma.sql`(
        ${amount.withdrawalAddress.toLowerCase()},
        ${amount.amountWei.toString()}::numeric,
        NOW()
      )`;
    });

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO withdrawal_address_claimable_snapshot (
        withdrawal_address,
        amount_wei,
        updated_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (withdrawal_address) DO UPDATE
      SET
        amount_wei = EXCLUDED.amount_wei,
        updated_at = EXCLUDED.updated_at
    `);
  }

  /**
   * Removes claimable snapshot rows for withdrawal addresses no longer tracked by any cluster.
   */
  async pruneUntrackedWithdrawalAddresses(trackedWithdrawalAddresses: string[]): Promise<void> {
    if (trackedWithdrawalAddresses.length === 0) {
      await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM withdrawal_address_claimable_snapshot
      `);
      return;
    }

    const normalizedAddresses = trackedWithdrawalAddresses.map((address) => address.toLowerCase());

    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM withdrawal_address_claimable_snapshot
      WHERE withdrawal_address NOT IN (${Prisma.join(normalizedAddresses)})
    `);
  }
}
