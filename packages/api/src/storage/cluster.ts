import { ClusterVisibility, PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

interface CreateClusterData {
  name: string;
  ownerId: bigint;
  visibility: ClusterVisibility;
  feeRecipientAddress?: string | null;
}

interface UpdateClusterData {
  name?: string;
  visibility?: ClusterVisibility;
  feeRecipientAddress?: string | null;
}

/**
 * ClusterStorage - Database persistence layer for cluster operations
 * Uses Prisma ORM for standard CRUD operations
 */
export class ClusterStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Create a new cluster
   */
  async create(data: CreateClusterData) {
    return this.prisma.cluster.create({ data });
  }

  /**
   * Find cluster by ID
   */
  async findById(id: string) {
    return this.prisma.cluster.findUnique({ where: { id } });
  }

  /**
   * Find cluster by ID with validators and their details
   * Optimized to fetch all data in a single query
   */
  async findByIdWithValidators(id: string) {
    return this.prisma.cluster.findUnique({
      where: { id },
      include: {
        validators: {
          select: {
            validatorIndex: true,
            validator: {
              select: {
                withdrawalAddress: true,
                status: true,
                balance: true,
                effectiveBalance: true,
                pubkey: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Get unique withdrawal addresses from validators in a cluster
   * Uses distinct query for optimal performance
   */
  async getWithdrawalAddresses(clusterId: string): Promise<string[]> {
    const results = await this.prisma.validator.findMany({
      where: {
        clusters: {
          some: { clusterId },
        },
        withdrawalAddress: { not: null },
      },
      select: { withdrawalAddress: true },
      distinct: ['withdrawalAddress'],
    });

    return results.map((r) => r.withdrawalAddress as string);
  }

  /**
   * List clusters by owner with validator count
   */
  async listByOwner(ownerId: bigint) {
    return this.prisma.cluster.findMany({
      where: { ownerId },
      include: { _count: { select: { validators: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update cluster by ID
   */
  async update(id: string, data: UpdateClusterData) {
    return this.prisma.cluster.update({ where: { id }, data });
  }

  /**
   * Delete cluster by ID
   * ClusterValidator records are cascade deleted automatically
   */
  async delete(id: string) {
    return this.prisma.cluster.delete({ where: { id } });
  }

  /**
   * Add validators to cluster
   * Uses skipDuplicates to handle idempotent additions
   * @returns Number of validators actually added
   */
  async addValidators(clusterId: string, validatorIndexes: number[]) {
    const result = await this.prisma.clusterValidator.createMany({
      data: validatorIndexes.map((idx) => ({ clusterId, validatorIndex: idx })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Remove a validator from cluster
   */
  async removeValidator(clusterId: string, validatorIndex: number) {
    return this.prisma.clusterValidator.delete({
      where: { clusterId_validatorIndex: { clusterId, validatorIndex } },
    });
  }

  /**
   * Remove validators from cluster by withdrawal address (case-insensitive)
   * @returns Number of validators removed
   */
  async removeValidatorsByWithdrawalAddress(clusterId: string, withdrawalAddress: string) {
    // Find validators in this cluster that have the given withdrawal address
    const validatorsToRemove = await this.prisma.clusterValidator.findMany({
      where: {
        clusterId,
        validator: {
          withdrawalAddress: { equals: withdrawalAddress, mode: 'insensitive' },
        },
      },
      select: { validatorIndex: true },
    });

    if (validatorsToRemove.length === 0) {
      return 0;
    }

    const result = await this.prisma.clusterValidator.deleteMany({
      where: {
        clusterId,
        validatorIndex: { in: validatorsToRemove.map((v) => v.validatorIndex) },
      },
    });

    return result.count;
  }

  /**
   * Remove validators from cluster by indexes
   * @returns Number of validators removed
   */
  async removeValidatorsByIndexes(clusterId: string, validatorIndexes: number[]) {
    const result = await this.prisma.clusterValidator.deleteMany({
      where: {
        clusterId,
        validatorIndex: { in: validatorIndexes },
      },
    });

    return result.count;
  }

  /**
   * Find validator indexes by withdrawal address (case-insensitive)
   * Only returns validators that exist in the validator table
   */
  async findValidatorIndexesByWithdrawalAddress(withdrawalAddress: string): Promise<number[]> {
    const validators = await this.prisma.validator.findMany({
      where: {
        withdrawalAddress: { equals: withdrawalAddress, mode: 'insensitive' },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return validators.map((v) => v.id);
  }

  /**
   * Verify which validator indexes exist in the validator table
   * @returns Object with existing and notFound arrays
   */
  async verifyValidatorIndexes(
    indexes: number[],
  ): Promise<{ existing: number[]; notFound: number[] }> {
    const validators = await this.prisma.validator.findMany({
      where: { id: { in: indexes } },
      select: { id: true },
    });

    const existingSet = new Set(validators.map((v) => v.id));
    const existing = indexes.filter((idx) => existingSet.has(idx));
    const notFound = indexes.filter((idx) => !existingSet.has(idx));

    return { existing, notFound };
  }

  /**
   * Get aggregated snapshot data for a cluster's validators
   */
  async getClusterSnapshot(clusterId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        active_count: bigint;
        inactive_count: bigint;
        total_balance: bigint | null;
        total_effective_balance: bigint | null;
        attestations_total: bigint | null;
        attestations_missed: bigint | null;
        performance_1h: string | null;
        performance_1d: string | null;
        performance_1w: string | null;
        performance_1m: string | null;
        apy_1h: string | null;
        apy_1d: string | null;
        apy_w: string | null;
        apy_1m: string | null;
        consensus_reward_1h: bigint | null;
        consensus_reward_1d: bigint | null;
        consensus_reward_1w: bigint | null;
        consensus_reward_1m: bigint | null;
        missed_reward_1h: bigint | null;
        missed_reward_1d: bigint | null;
        missed_reward_1w: bigint | null;
        missed_reward_1m: bigint | null;
        execution_reward_1h: string | null;
        execution_reward_1d: string | null;
        execution_reward_1w: string | null;
        execution_reward_1m: string | null;
        beacon_status_breakdown: string;
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE vss.is_inactive = false)::bigint AS active_count,
        COUNT(*) FILTER (WHERE vss.is_inactive = true)::bigint AS inactive_count,
        COALESCE(SUM(vss.balance), 0)::bigint AS total_balance,
        COALESCE(SUM(vss.effective_balance), 0)::bigint AS total_effective_balance,
        COALESCE(SUM(vss.attestations_total), 0)::bigint AS attestations_total,
        COALESCE(SUM(vss.attestations_missed), 0)::bigint AS attestations_missed,
        -- Weighted average performance (by attestation count)
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_1h, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_1h,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_1d, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_1d,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_1w, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_1w,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_1m, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_1m,
        -- Weighted average APY (by balance)
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_1h, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_1h,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_1d, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_1d,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_w, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_w,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_1m, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_1m,
        -- Sum rewards
        SUM(vss.consensus_reward_1h)::bigint AS consensus_reward_1h,
        SUM(vss.consensus_reward_1d)::bigint AS consensus_reward_1d,
        SUM(vss.consensus_reward_1w)::bigint AS consensus_reward_1w,
        SUM(vss.consensus_reward_1m)::bigint AS consensus_reward_1m,
        SUM(vss.missed_reward_1h)::bigint AS missed_reward_1h,
        SUM(vss.missed_reward_1d)::bigint AS missed_reward_1d,
        SUM(vss.missed_reward_1w)::bigint AS missed_reward_1w,
        SUM(vss.missed_reward_1m)::bigint AS missed_reward_1m,
        SUM(vss.execution_reward_1h)::text AS execution_reward_1h,
        SUM(vss.execution_reward_1d)::text AS execution_reward_1d,
        SUM(vss.execution_reward_1w)::text AS execution_reward_1w,
        SUM(vss.execution_reward_1m)::text AS execution_reward_1m,
        -- Beacon status breakdown as JSON
        COALESCE(
          (SELECT json_object_agg(bs, cnt)::text
           FROM (
             SELECT vss2.beacon_status::text AS bs, COUNT(*)::int AS cnt
             FROM cluster_validator cv2
             JOIN validators_snapshot_stats vss2 ON cv2.validator_index = vss2.validator_index
             WHERE cv2.cluster_id = ${clusterId}
             GROUP BY vss2.beacon_status
           ) sub),
          '{}'
        ) AS beacon_status_breakdown
      FROM cluster_validator cv
      JOIN validators_snapshot_stats vss ON cv.validator_index = vss.validator_index
      WHERE cv.cluster_id = ${clusterId}
    `;

    return rows[0] ?? null;
  }

  /**
   * Check if cluster exists and belongs to owner
   */
  async existsForOwner(id: string, ownerId: bigint): Promise<boolean> {
    const cluster = await this.prisma.cluster.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    return cluster !== null;
  }
}
