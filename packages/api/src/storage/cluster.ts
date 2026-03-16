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
   * Find cluster by ID with validators enriched with snapshot stats.
   * Single raw query joining cluster, cluster_validator, validator, and validators_snapshot_stats.
   */
  async findByIdWithValidatorsAndSnapshot(id: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        cluster_id: string;
        cluster_name: string;
        cluster_visibility: string;
        cluster_fee_recipient_address: string | null;
        cluster_owner_id: bigint;
        cluster_created_at: Date;
        validator_index: number;
        withdrawal_address: string | null;
        beacon_status: number | null;
        balance: bigint;
        effective_balance: bigint | null;
        pubkey: string | null;
        is_inactive: boolean | null;
        performance_h: string | null;
        attestations_missed: bigint | null;
      }>
    >`
      SELECT
        c.id            AS cluster_id,
        c.name          AS cluster_name,
        c.visibility    AS cluster_visibility,
        c.fee_recipient_address AS cluster_fee_recipient_address,
        c.owner_id      AS cluster_owner_id,
        c.created_at    AS cluster_created_at,
        cv.validator_index,
        v.withdrawal_address,
        v.status        AS beacon_status,
        v.balance,
        v.effective_balance,
        v.pubkey,
        vss.is_inactive,
        vss.performance_h::text AS performance_h,
        vss.attestations_missed
      FROM cluster c
      JOIN cluster_validator cv ON cv.cluster_id = c.id
      JOIN validator v ON v.id = cv.validator_index
      LEFT JOIN validators_snapshot_stats vss ON vss.validator_index = cv.validator_index
      WHERE c.id = ${id}
    `;

    if (rows.length === 0) return null;

    const first = rows[0];
    return {
      id: first.cluster_id,
      name: first.cluster_name,
      visibility: first.cluster_visibility,
      feeRecipientAddress: first.cluster_fee_recipient_address,
      ownerId: first.cluster_owner_id,
      createdAt: first.cluster_created_at,
      validators: rows.map((r) => ({
        validatorIndex: r.validator_index,
        withdrawalAddress: r.withdrawal_address,
        beaconStatus: r.beacon_status,
        balance: r.balance,
        effectiveBalance: r.effective_balance,
        pubkey: r.pubkey,
        isInactive: r.is_inactive ?? false,
        performanceH: r.performance_h !== null ? Number(r.performance_h) : null,
        attestationsMissed: r.attestations_missed !== null ? Number(r.attestations_missed) : null,
      })),
    };
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
        performance_h: string | null;
        performance_d: string | null;
        performance_w: string | null;
        performance_m: string | null;
        apy_h: string | null;
        apy_d: string | null;
        apy_w: string | null;
        apy_m: string | null;
        consensus_reward_h: bigint | null;
        consensus_reward_d: bigint | null;
        consensus_reward_w: bigint | null;
        consensus_reward_m: bigint | null;
        missed_reward_h: bigint | null;
        missed_reward_d: bigint | null;
        missed_reward_w: bigint | null;
        missed_reward_m: bigint | null;
        execution_reward_h: string | null;
        execution_reward_d: string | null;
        execution_reward_w: string | null;
        execution_reward_m: string | null;
        attestation_efficiency_d: string | null;
        attestation_efficiency_w: string | null;
        attestation_efficiency_m: string | null;
        avg_attestation_delay_d: string | null;
        avg_attestation_delay_w: string | null;
        avg_attestation_delay_m: string | null;
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
          THEN (SUM(COALESCE(vss.performance_h, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_h,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_d, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_d,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_w, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_w,
        CASE WHEN SUM(vss.attestations_total) > 0
          THEN (SUM(COALESCE(vss.performance_m, 0) * vss.attestations_total)::numeric / SUM(vss.attestations_total))::numeric(5,4)::text
          ELSE NULL END AS performance_m,
        -- Weighted average APY (by balance)
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_h, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_h,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_d, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_d,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_w, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_w,
        CASE WHEN SUM(vss.balance) > 0
          THEN (SUM(COALESCE(vss.apy_m, 0) * vss.balance)::numeric / SUM(vss.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_m,
        -- Sum rewards
        SUM(vss.consensus_reward_h)::bigint AS consensus_reward_h,
        SUM(vss.consensus_reward_d)::bigint AS consensus_reward_d,
        SUM(vss.consensus_reward_w)::bigint AS consensus_reward_w,
        SUM(vss.consensus_reward_m)::bigint AS consensus_reward_m,
        SUM(vss.missed_reward_h)::bigint AS missed_reward_h,
        SUM(vss.missed_reward_d)::bigint AS missed_reward_d,
        SUM(vss.missed_reward_w)::bigint AS missed_reward_w,
        SUM(vss.missed_reward_m)::bigint AS missed_reward_m,
        SUM(vss.execution_reward_h)::text AS execution_reward_h,
        SUM(vss.execution_reward_d)::text AS execution_reward_d,
        SUM(vss.execution_reward_w)::text AS execution_reward_w,
        SUM(vss.execution_reward_m)::text AS execution_reward_m,
        -- Weighted average attestation efficiency (only validators that have data)
        (SUM(vss.attestation_efficiency_d * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.attestation_efficiency_d IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS attestation_efficiency_d,
        (SUM(vss.attestation_efficiency_w * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.attestation_efficiency_w IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS attestation_efficiency_w,
        (SUM(vss.attestation_efficiency_m * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.attestation_efficiency_m IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS attestation_efficiency_m,
        -- Weighted average attestation delay (only validators that have data)
        (SUM(vss.avg_attestation_delay_d * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.avg_attestation_delay_d IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_d,
        (SUM(vss.avg_attestation_delay_w * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.avg_attestation_delay_w IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_w,
        (SUM(vss.avg_attestation_delay_m * vss.attestations_total) / NULLIF(SUM(CASE WHEN vss.avg_attestation_delay_m IS NOT NULL THEN vss.attestations_total ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_m,
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
   * Get all unique validator indexes across all clusters for an owner
   */
  async findAllValidatorIndexesByOwner(ownerId: bigint): Promise<number[]> {
    const results = await this.prisma.clusterValidator.findMany({
      where: {
        cluster: {
          ownerId,
        },
      },
      select: {
        validatorIndex: true,
      },
      distinct: ['validatorIndex'],
    });
    return results.map((r) => r.validatorIndex);
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
