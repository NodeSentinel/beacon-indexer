import { PrismaClient } from '@beacon-indexer/db';

export interface ConsolidationEventRow {
  slot: number;
  request_index: number;
  source_address: string | null;
  source_pubkey: string;
  target_pubkey: string;
  source_validator_index: number;
  target_validator_index: number | null;
}

export class ConsolidationStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists consolidation requests whose source validator belongs to the selected cluster.
   */
  async getConsolidations(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<ConsolidationEventRow[]>`
        SELECT
          c.slot,
          c.request_index,
          c.source_address,
          c.source_pubkey,
          c.target_pubkey,
          source_validator.id AS source_validator_index,
          target_validator.id AS target_validator_index
        FROM validator_request_consolidations c
        JOIN validator source_validator ON source_validator.pubkey = c.source_pubkey
        JOIN cluster_validator cv ON cv.validator_index = source_validator.id
        LEFT JOIN validator target_validator ON target_validator.pubkey = c.target_pubkey
        WHERE cv.cluster_id = ${clusterId}
        ORDER BY c.slot DESC, c.request_index DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM validator_request_consolidations c
        JOIN validator source_validator ON source_validator.pubkey = c.source_pubkey
        JOIN cluster_validator cv ON cv.validator_index = source_validator.id
        WHERE cv.cluster_id = ${clusterId}
      `,
    ]);

    return { rows, totalCount: Number(countResult[0].count) };
  }
}
