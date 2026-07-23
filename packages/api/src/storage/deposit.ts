import { PrismaClient } from '@beacon-indexer/db';

export interface DepositEventRow {
  slot: number;
  source: string;
  index: number;
  pubkey: string;
  withdrawal_credentials: string;
  amount: bigint;
  validator_index: number;
}

export class DepositStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists deposits whose deposited pubkeys belong to validators in the selected cluster.
   */
  async getDeposits(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<DepositEventRow[]>`
        SELECT
          d.slot,
          d.source,
          d.index,
          d.pubkey,
          d.withdrawal_credentials,
          d.amount,
          v.id AS validator_index
        FROM validator_deposits d
        JOIN validator v ON v.pubkey = d.pubkey
        JOIN cluster_validator cv ON cv.validator_index = v.id
        WHERE cv.cluster_id = ${clusterId}
        ORDER BY d.slot DESC, d.source ASC, d.index DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM validator_deposits d
        JOIN validator v ON v.pubkey = d.pubkey
        JOIN cluster_validator cv ON cv.validator_index = v.id
        WHERE cv.cluster_id = ${clusterId}
      `,
    ]);

    return { rows, totalCount: Number(countResult[0].count) };
  }
}
