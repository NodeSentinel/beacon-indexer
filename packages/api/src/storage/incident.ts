import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

export class IncidentStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async listClusterIncidents(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          status: 'open' | 'closed';
          opened_at: Date;
          opened_slot: number;
          opened_validator_indexes: number[];
          current_validator_indexes: number[];
          affected_validator_indexes: number[];
          closed_at: Date | null;
          closed_slot: number | null;
          duration_slots: number | null;
          duration_seconds: number | null;
          missed_attestations: number | null;
          missed_consensus_rewards: bigint | null;
        }>
      >`
        SELECT
          ci.id,
          ci.status::text AS status,
          ci.opened_at,
          ci.opened_slot,
          ci.opened_validator_indexes,
          ci.current_validator_indexes,
          ci.affected_validator_indexes,
          ci.closed_at,
          ci.closed_slot,
          ci.duration_slots,
          ci.duration_seconds,
          ci.missed_attestations,
          ci.missed_consensus_rewards
        FROM cluster_incident ci
        WHERE ci.cluster_id = ${clusterId}
        ORDER BY ci.opened_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM cluster_incident
        WHERE cluster_id = ${clusterId}
      `,
    ]);

    return {
      rows,
      totalCount: Number(countResult[0]?.count ?? BigInt(0)),
    };
  }
}
