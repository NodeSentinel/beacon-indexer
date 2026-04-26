import { PrismaClient } from '@beacon-indexer/db';

export class BlockStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get paginated block proposals for a cluster or single validator
   */
  async getBlockProposals(params: {
    clusterId?: string;
    validatorIndex?: number;
    page: number;
    pageSize: number;
  }) {
    const { page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    if (params.clusterId) {
      const [rows, countResult] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            slot: number;
            block_number: number | null;
            proposer_index: number;
            consensus_reward: bigint | null;
            execution_reward: string | null;
          }>
        >`
          SELECT s.slot, s.block_number, s.proposer_index, s.consensus_reward, s.execution_reward::text
          FROM slot s
          JOIN cluster_validator cv ON s.proposer_index = cv.validator_index
          WHERE cv.cluster_id = ${params.clusterId}
            AND s.proposer_index IS NOT NULL
          ORDER BY s.slot DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM slot s
          JOIN cluster_validator cv ON s.proposer_index = cv.validator_index
          WHERE cv.cluster_id = ${params.clusterId}
            AND s.proposer_index IS NOT NULL
        `,
      ]);

      return { rows, totalCount: Number(countResult[0].count) };
    }

    const validatorIndex = params.validatorIndex!;
    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          slot: number;
          block_number: number | null;
          proposer_index: number;
          consensus_reward: bigint | null;
          execution_reward: string | null;
        }>
      >`
        SELECT slot, block_number, proposer_index, consensus_reward, execution_reward::text
        FROM slot
        WHERE proposer_index = ${validatorIndex}
        ORDER BY slot DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM slot
        WHERE proposer_index = ${validatorIndex}
      `,
    ]);

    return { rows, totalCount: Number(countResult[0].count) };
  }
}
