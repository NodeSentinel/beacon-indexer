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

export interface DepositEventsResult {
  hasNextPage: boolean;
  rows: DepositEventRow[];
}

export class DepositStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists deposits whose deposited pubkeys belong to validators in the selected cluster.
   */
  async getDeposits(params: {
    clusterId: string;
    page: number;
    pageSize: number;
  }): Promise<DepositEventsResult> {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const limit = pageSize + 1;

    const rows = await this.prisma.$queryRaw<DepositEventRow[]>`
      SELECT
        d.slot,
        d.source,
        d.index,
        d.pubkey,
        d.withdrawal_credentials AS "withdrawalCredentials",
        d.amount,
        v.id AS "validatorIndex"
      FROM validator_deposits d
      JOIN validator v ON v.pubkey = d.pubkey
      JOIN cluster_validator cv ON cv.validator_index = v.id
      WHERE cv.cluster_id = ${clusterId}
      ORDER BY d.slot DESC, d.source ASC, d.index DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      hasNextPage: rows.length > pageSize,
      rows: rows.slice(0, pageSize),
    };
  }
}
