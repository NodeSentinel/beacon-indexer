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

export interface ConsolidationEventsResult {
  hasNextPage: boolean;
  rows: ConsolidationEventRow[];
}

export class ConsolidationStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists consolidation requests where either side belongs to the selected cluster.
   */
  async getConsolidations(params: {
    clusterId: string;
    page: number;
    pageSize: number;
  }): Promise<ConsolidationEventsResult> {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const limit = pageSize + 1;

    const rows = await this.prisma.$queryRaw<ConsolidationEventRow[]>`
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
      LEFT JOIN validator target_validator ON target_validator.pubkey = c.target_pubkey
      WHERE EXISTS (
        SELECT 1
        FROM cluster_validator cv
        WHERE cv.cluster_id = ${clusterId}
          AND cv.validator_index IN (source_validator.id, target_validator.id)
      )
      ORDER BY c.slot DESC, c.request_index DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      hasNextPage: rows.length > pageSize,
      rows: rows.slice(0, pageSize),
    };
  }
}
