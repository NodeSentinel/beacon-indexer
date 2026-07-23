import { PrismaClient } from '@beacon-indexer/db';

export interface WithdrawalEventRow {
  source: string;
  slot: number;
  event_index: string;
  validator_index: number;
  pubkey: string | null;
  source_address: string | null;
  amount: bigint;
}

export class WithdrawalStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists execution payload and request withdrawals for validators in the selected cluster.
   */
  async getWithdrawals(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<WithdrawalEventRow[]>`
        WITH withdrawal_events AS (
          SELECT
            'payload'::text AS source,
            w.slot,
            w.withdrawal_index::text AS event_index,
            w.withdrawal_index::numeric AS sort_index,
            w.validator_index::integer AS validator_index,
            NULL::text AS pubkey,
            NULL::text AS source_address,
            w.amount
          FROM validator_withdrawals w
          JOIN cluster_validator cv ON cv.validator_index::text = w.validator_index
          WHERE cv.cluster_id = ${clusterId}

          UNION ALL

          SELECT
            'request'::text AS source,
            wr.slot,
            wr.request_index::text AS event_index,
            wr.request_index::numeric AS sort_index,
            v.id AS validator_index,
            wr.pub_key AS pubkey,
            wr.source_address,
            wr.amount
          FROM validator_request_withdrawals wr
          JOIN validator v ON v.pubkey = wr.pub_key
          JOIN cluster_validator cv ON cv.validator_index = v.id
          WHERE cv.cluster_id = ${clusterId}
        )
        SELECT source, slot, event_index, validator_index, pubkey, source_address, amount
        FROM withdrawal_events
        ORDER BY slot DESC, source ASC, sort_index DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT 1
          FROM validator_withdrawals w
          JOIN cluster_validator cv ON cv.validator_index::text = w.validator_index
          WHERE cv.cluster_id = ${clusterId}

          UNION ALL

          SELECT 1
          FROM validator_request_withdrawals wr
          JOIN validator v ON v.pubkey = wr.pub_key
          JOIN cluster_validator cv ON cv.validator_index = v.id
          WHERE cv.cluster_id = ${clusterId}
        ) withdrawal_events
      `,
    ]);

    return { rows, totalCount: Number(countResult[0].count) };
  }
}
