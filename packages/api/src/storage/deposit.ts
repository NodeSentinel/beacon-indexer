import { PrismaClient } from '@beacon-indexer/db';

export interface DepositEventRow {
  slot: number;
  source: string;
  index: number;
  pubkey: string;
  withdrawalCredentials: string;
  amount: bigint;
  validatorIndex: number;
}

export class DepositStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists deposits whose deposited pubkeys belong to validators in the selected cluster.
   */
  async getDeposits(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const validators = await this.prisma.validator.findMany({
      where: {
        clusters: { some: { clusterId } },
        pubkey: { not: null },
      },
      select: {
        id: true,
        pubkey: true,
      },
    });
    const validatorIndexByPubkey = new Map(
      validators
        .filter(
          (validator): validator is { id: number; pubkey: string } => validator.pubkey !== null,
        )
        .map((validator) => [validator.pubkey, validator.id]),
    );
    const pubkeys = Array.from(validatorIndexByPubkey.keys());

    if (pubkeys.length === 0) {
      return { rows: [], totalCount: 0 };
    }

    const [deposits, totalCount] = await Promise.all([
      this.prisma.validatorDeposits.findMany({
        where: { pubkey: { in: pubkeys } },
        orderBy: [{ slot: 'desc' }, { source: 'asc' }, { index: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.validatorDeposits.count({
        where: { pubkey: { in: pubkeys } },
      }),
    ]);
    const rows = deposits.map((deposit) => ({
      slot: deposit.slot,
      source: deposit.source,
      index: deposit.index,
      pubkey: deposit.pubkey,
      withdrawalCredentials: deposit.withdrawalCredentials,
      amount: deposit.amount,
      validatorIndex: validatorIndexByPubkey.get(deposit.pubkey)!,
    }));

    return { rows, totalCount };
  }
}
