import { PrismaClient } from '@beacon-indexer/db';

export interface WithdrawalEventRow {
  slot: number;
  request_index: number;
  validator_index: number;
  pubkey: string;
  source_address: string | null;
  amount: bigint;
}

export interface WithdrawalEventsResult {
  hasNextPage: boolean;
  rows: WithdrawalEventRow[];
}

export class WithdrawalStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists operator-initiated withdrawal requests for validators in the selected cluster.
   */
  async getWithdrawals(params: {
    clusterId: string;
    page: number;
    pageSize: number;
  }): Promise<WithdrawalEventsResult> {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const limit = pageSize + 1;

    const rows = await this.prisma.$queryRaw<WithdrawalEventRow[]>`
      SELECT
        wr.slot,
        wr.request_index,
        v.id AS validator_index,
        wr.pub_key AS pubkey,
        wr.source_address,
        wr.amount
      FROM validator_request_withdrawals wr
      JOIN validator v ON v.pubkey = wr.pub_key
      JOIN cluster_validator cv ON cv.validator_index = v.id
      WHERE cv.cluster_id = ${clusterId}
      ORDER BY wr.slot DESC, wr.request_index DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      hasNextPage: rows.length > pageSize,
      rows: rows.slice(0, pageSize),
    };
  }
}
