import { PrismaClient } from '@beacon-indexer/db';

export interface PayoutEventRow {
  slot: number;
  payout_index: string;
  validator_index: number;
  amount: bigint;
}

export interface PayoutEventsResult {
  hasNextPage: boolean;
  rows: PayoutEventRow[];
}

export class PayoutStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists completed beacon-chain payouts for validators in the selected cluster.
   */
  async getPayouts(params: {
    clusterId: string;
    page: number;
    pageSize: number;
  }): Promise<PayoutEventsResult> {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const limit = pageSize + 1;

    const rows = await this.prisma.$queryRaw<PayoutEventRow[]>`
      SELECT
        w.slot,
        w.withdrawal_index::text AS payout_index,
        w.validator_index,
        w.amount
      FROM validator_withdrawals w
      JOIN cluster_validator cv ON cv.validator_index = w.validator_index
      WHERE cv.cluster_id = ${clusterId}
      ORDER BY w.slot DESC, w.withdrawal_index DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      hasNextPage: rows.length > pageSize,
      rows: rows.slice(0, pageSize),
    };
  }
}
