import { ClusterVisibility, Prisma, PrismaClient } from '@beacon-indexer/db';

interface CreateClusterData {
  name: string;
  ownerId: string;
  visibility: ClusterVisibility;
  feeRecipientAddress?: string | null;
  lidoCsmOperatorId?: number;
  validatorIndexes?: number[];
}

interface UpdateClusterData {
  name?: string;
  visibility?: ClusterVisibility;
  feeRecipientAddress?: string | null;
}

interface UpdateClusterWithValidatorsData extends UpdateClusterData {
  validatorIndexes?: number[];
}

type UpdateClusterWithLidoOperatorData = UpdateClusterWithValidatorsData;

/**
 * ClusterStorage - Database persistence layer for cluster operations
 * Uses Prisma ORM for standard CRUD operations
 */
export class ClusterStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Removes duplicate validator indexes while preserving the first occurrence.
   */
  private uniqueValidatorIndexes(indexes: number[]): number[] {
    const seen = new Set<number>();

    // Keeps the diff deterministic even when the caller sends repeated indexes.
    return indexes.filter((index) => {
      if (seen.has(index)) {
        return false;
      }

      seen.add(index);
      return true;
    });
  }

  /**
   * Create a new cluster
   */
  async create(data: CreateClusterData) {
    // Persists the cluster and its initial membership in one transaction so callers never
    // observe a cluster without the validators that were part of the create request.
    return this.prisma.$transaction(async (tx) => {
      const validatorIndexes = this.uniqueValidatorIndexes(data.validatorIndexes ?? []);

      const cluster = await tx.cluster.create({
        data: {
          name: data.name,
          ownerId: data.ownerId,
          visibility: data.visibility,
          feeRecipientAddress: data.feeRecipientAddress,
          lidoOperatorId:
            data.lidoCsmOperatorId !== undefined ? data.lidoCsmOperatorId.toString() : undefined,
        },
      });

      if (validatorIndexes.length > 0) {
        await tx.clusterValidator.createMany({
          data: validatorIndexes.map((validatorIndex) => ({
            clusterId: cluster.id,
            validatorIndex,
          })),
          skipDuplicates: true,
        });
      }

      return {
        ...cluster,
        validatorCount: validatorIndexes.length,
      };
    });
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
   * Single raw query joining cluster membership with the split snapshot tables.
   */
  async findByIdWithValidatorsAndSnapshot(id: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        cluster_id: string;
        cluster_name: string;
        cluster_visibility: string;
        cluster_fee_recipient_address: string | null;
        cluster_lido_operator_id: string | null;
        cluster_owner_id: string;
        cluster_created_at: Date;
        validator_index: number | null;
        withdrawal_address: string | null;
        beacon_status: number | null;
        balance: bigint | null;
        effective_balance: bigint | null;
        pubkey: string | null;
        is_inactive: boolean | null;
        performance_h: string | null;
      }>
    >`
      SELECT
        c.id            AS cluster_id,
        c.name          AS cluster_name,
        c.visibility    AS cluster_visibility,
        c.fee_recipient_address AS cluster_fee_recipient_address,
        c.lido_operator_id AS cluster_lido_operator_id,
        c.owner_id      AS cluster_owner_id,
        c.created_at    AS cluster_created_at,
        cv.validator_index,
        v.withdrawal_address,
        v.status        AS beacon_status,
        v.balance,
        v.effective_balance,
        v.pubkey,
        vsa.is_inactive,
        vsp.performance_h::text AS performance_h
      FROM cluster c
      LEFT JOIN cluster_validator cv ON cv.cluster_id = c.id
      LEFT JOIN validator v ON v.id = cv.validator_index
      LEFT JOIN validators_snapshot_activity vsa ON vsa.validator_index = cv.validator_index
      LEFT JOIN validators_snapshot_performance vsp ON vsp.validator_index = cv.validator_index
      WHERE c.id = ${id}
    `;

    if (rows.length === 0) return null;

    const first = rows[0];
    return {
      id: first.cluster_id,
      name: first.cluster_name,
      visibility: first.cluster_visibility,
      feeRecipientAddress: first.cluster_fee_recipient_address,
      lidoOperatorId: first.cluster_lido_operator_id,
      ownerId: first.cluster_owner_id,
      createdAt: first.cluster_created_at,
      validators: rows
        .filter((r) => r.validator_index !== null)
        .map((r) => ({
          validatorIndex: r.validator_index!,
          withdrawalAddress: r.withdrawal_address,
          beaconStatus: r.beacon_status,
          balance: r.balance!,
          effectiveBalance: r.effective_balance,
          pubkey: r.pubkey,
          isInactive: r.is_inactive ?? false,
          performanceH: r.performance_h !== null ? Number(r.performance_h) : null,
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
  async listByOwner(ownerId: string) {
    return this.prisma.cluster.findMany({
      where: { ownerId },
      include: { _count: { select: { validators: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a cross-user summary of clusters and validator membership counts.
   */
  async getSummary() {
    const [clusters, uniqueValidators, totalUsers] = await Promise.all([
      this.prisma.cluster.findMany({
        include: {
          owner: { select: { username: true, telegramId: true } },
          validators: {
            select: {
              validator: {
                select: {
                  effectiveBalance: true,
                },
              },
            },
          },
          _count: { select: { validators: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.clusterValidator.groupBy({
        by: ['validatorIndex'],
      }),
      this.prisma.user.count(),
    ]);
    let totalEffectiveBalance = BigInt(0);
    const clusterSummaries = clusters.map((cluster) => {
      let effectiveBalance = BigInt(0);

      for (const clusterValidator of cluster.validators) {
        effectiveBalance += clusterValidator.validator.effectiveBalance ?? BigInt(0);
      }

      totalEffectiveBalance += effectiveBalance;

      return {
        id: cluster.id,
        name: cluster.name,
        ownerId: cluster.ownerId,
        ownerUsername: cluster.owner.telegramId === null ? 'annon' : cluster.owner.username,
        validatorCount: cluster._count.validators,
        effectiveBalance,
      };
    });

    return {
      totalClusters: clusters.length,
      totalUsers,
      totalUniqueValidators: uniqueValidators.length,
      totalEffectiveBalance,
      clusters: clusterSummaries,
    };
  }

  /**
   * Update cluster by ID
   */
  async update(id: string, data: UpdateClusterData) {
    return this.prisma.cluster.update({ where: { id }, data });
  }

  /**
   * Update cluster metadata and synchronize validator membership in one transaction.
   */
  private async updateWithValidatorsInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    data: UpdateClusterWithValidatorsData,
    extraData: { lidoOperatorId?: string } = {},
  ) {
    const validatorIndexes =
      data.validatorIndexes !== undefined
        ? this.uniqueValidatorIndexes(data.validatorIndexes)
        : undefined;
    const metadata = {
      name: data.name,
      visibility: data.visibility,
      feeRecipientAddress: data.feeRecipientAddress,
      lidoOperatorId: extraData.lidoOperatorId,
    };
    const hasMetadataUpdates = Object.values(metadata).some((value) => value !== undefined);

    // Reuses the stored cluster row when the save only changes validator membership.
    const cluster = hasMetadataUpdates
      ? await tx.cluster.update({
          where: { id },
          data: metadata,
        })
      : await tx.cluster.findUniqueOrThrow({
          where: { id },
        });

    if (validatorIndexes !== undefined) {
      // Reads the current membership first so the sync only writes the real delta.
      const currentValidators = await tx.clusterValidator.findMany({
        where: { clusterId: id },
        select: { validatorIndex: true },
      });

      const currentValidatorSet = new Set(currentValidators.map((row) => row.validatorIndex));
      const nextValidatorSet = new Set(validatorIndexes);

      // Adds validators that appear in the new draft but not in the stored cluster.
      const validatorIndexesToAdd = validatorIndexes.filter(
        (validatorIndex) => !currentValidatorSet.has(validatorIndex),
      );
      // Removes validators that are still stored but no longer appear in the saved draft.
      const validatorIndexesToRemove = currentValidators
        .map((row) => row.validatorIndex)
        .filter((validatorIndex) => !nextValidatorSet.has(validatorIndex));

      if (validatorIndexesToRemove.length > 0) {
        await tx.clusterValidator.deleteMany({
          where: {
            clusterId: id,
            validatorIndex: { in: validatorIndexesToRemove },
          },
        });
      }

      if (validatorIndexesToAdd.length > 0) {
        await tx.clusterValidator.createMany({
          data: validatorIndexesToAdd.map((validatorIndex) => ({
            clusterId: id,
            validatorIndex,
          })),
          skipDuplicates: true,
        });
      }
    }

    return cluster;
  }

  /**
   * Update cluster metadata and synchronize validator membership in one transaction.
   */
  async updateWithValidators(id: string, data: UpdateClusterWithValidatorsData) {
    // Runs the metadata update and membership sync together so saves are atomic.
    return this.prisma.$transaction((tx) => this.updateWithValidatorsInTransaction(tx, id, data));
  }

  /**
   * Update cluster data and persist the cluster's selected Lido CSM operator id.
   */
  async updateWithValidatorsAndLidoOperator(
    id: string,
    data: UpdateClusterWithLidoOperatorData,
    lidoCsmOperatorId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Stores the Lido operator id in the same cluster update used for metadata changes.
      return this.updateWithValidatorsInTransaction(tx, id, data, {
        lidoOperatorId: lidoCsmOperatorId.toString(),
      });
    });
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
      WITH merged_snapshot AS MATERIALIZED (
        SELECT
          cv.validator_index,
          vsa.is_inactive,
          b.balance,
          b.effective_balance,
          b.beacon_status,
          p.attestation_count_h,
          p.missed_attestation_count_h,
          p.attestation_count_d,
          p.missed_attestation_count_d,
          p.attestation_count_w,
          p.missed_attestation_count_w,
          p.attestation_count_m,
          p.missed_attestation_count_m,
          p.apy_h,
          p.apy_d,
          p.apy_w,
          p.apy_m,
          p.consensus_reward_h,
          p.consensus_reward_d,
          p.consensus_reward_w,
          p.consensus_reward_m,
          p.missed_reward_h,
          p.missed_reward_d,
          p.missed_reward_w,
          p.missed_reward_m,
          p.execution_reward_h,
          p.execution_reward_d,
          p.execution_reward_w,
          p.execution_reward_m,
          p.attestation_efficiency_d,
          p.attestation_efficiency_w,
          p.attestation_efficiency_m,
          p.avg_attestation_delay_d,
          p.avg_attestation_delay_w,
          p.avg_attestation_delay_m
        FROM cluster_validator cv
        LEFT JOIN validators_snapshot_activity vsa ON vsa.validator_index = cv.validator_index
        LEFT JOIN validators_snapshot_balances b ON b.validator_index = cv.validator_index
        LEFT JOIN validators_snapshot_performance p ON p.validator_index = cv.validator_index
        WHERE cv.cluster_id = ${clusterId}
      )
      SELECT
        COUNT(*) FILTER (WHERE merged_snapshot.is_inactive = false AND COALESCE(merged_snapshot.beacon_status, 0) IN (0, 1, 2, 3, 4))::bigint AS active_count,
        COUNT(*) FILTER (WHERE merged_snapshot.is_inactive = true AND COALESCE(merged_snapshot.beacon_status, 0) IN (0, 1, 2, 3, 4))::bigint AS inactive_count,
        COALESCE(SUM(merged_snapshot.balance), 0)::bigint AS total_balance,
        COALESCE(SUM(merged_snapshot.effective_balance), 0)::bigint AS total_effective_balance,
        -- Cluster performance: (total attestations - total missed) / total attestations per timeframe
        CASE WHEN SUM(merged_snapshot.attestation_count_h) > 0
          THEN ((SUM(merged_snapshot.attestation_count_h) - SUM(merged_snapshot.missed_attestation_count_h))::numeric / SUM(merged_snapshot.attestation_count_h))::numeric(5,4)::text
          ELSE NULL END AS performance_h,
        CASE WHEN SUM(merged_snapshot.attestation_count_d) > 0
          THEN ((SUM(merged_snapshot.attestation_count_d) - SUM(merged_snapshot.missed_attestation_count_d))::numeric / SUM(merged_snapshot.attestation_count_d))::numeric(5,4)::text
          ELSE NULL END AS performance_d,
        CASE WHEN SUM(merged_snapshot.attestation_count_w) > 0
          THEN ((SUM(merged_snapshot.attestation_count_w) - SUM(merged_snapshot.missed_attestation_count_w))::numeric / SUM(merged_snapshot.attestation_count_w))::numeric(5,4)::text
          ELSE NULL END AS performance_w,
        CASE WHEN SUM(merged_snapshot.attestation_count_m) > 0
          THEN ((SUM(merged_snapshot.attestation_count_m) - SUM(merged_snapshot.missed_attestation_count_m))::numeric / SUM(merged_snapshot.attestation_count_m))::numeric(5,4)::text
          ELSE NULL END AS performance_m,
        -- Weighted average APY (by balance)
        CASE WHEN SUM(merged_snapshot.balance) > 0
          THEN (SUM(COALESCE(merged_snapshot.apy_h, 0) * merged_snapshot.balance)::numeric / SUM(merged_snapshot.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_h,
        CASE WHEN SUM(merged_snapshot.balance) > 0
          THEN (SUM(COALESCE(merged_snapshot.apy_d, 0) * merged_snapshot.balance)::numeric / SUM(merged_snapshot.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_d,
        CASE WHEN SUM(merged_snapshot.balance) > 0
          THEN (SUM(COALESCE(merged_snapshot.apy_w, 0) * merged_snapshot.balance)::numeric / SUM(merged_snapshot.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_w,
        CASE WHEN SUM(merged_snapshot.balance) > 0
          THEN (SUM(COALESCE(merged_snapshot.apy_m, 0) * merged_snapshot.balance)::numeric / SUM(merged_snapshot.balance))::numeric(5,2)::text
          ELSE NULL END AS apy_m,
        -- Sum rewards
        SUM(merged_snapshot.consensus_reward_h)::bigint AS consensus_reward_h,
        SUM(merged_snapshot.consensus_reward_d)::bigint AS consensus_reward_d,
        SUM(merged_snapshot.consensus_reward_w)::bigint AS consensus_reward_w,
        SUM(merged_snapshot.consensus_reward_m)::bigint AS consensus_reward_m,
        SUM(merged_snapshot.missed_reward_h)::bigint AS missed_reward_h,
        SUM(merged_snapshot.missed_reward_d)::bigint AS missed_reward_d,
        SUM(merged_snapshot.missed_reward_w)::bigint AS missed_reward_w,
        SUM(merged_snapshot.missed_reward_m)::bigint AS missed_reward_m,
        SUM(merged_snapshot.execution_reward_h)::text AS execution_reward_h,
        SUM(merged_snapshot.execution_reward_d)::text AS execution_reward_d,
        SUM(merged_snapshot.execution_reward_w)::text AS execution_reward_w,
        SUM(merged_snapshot.execution_reward_m)::text AS execution_reward_m,
        -- Weighted attestation efficiency (by attestation count per timeframe)
        (SUM(merged_snapshot.attestation_efficiency_d * merged_snapshot.attestation_count_d) / NULLIF(SUM(CASE WHEN merged_snapshot.attestation_efficiency_d IS NOT NULL THEN merged_snapshot.attestation_count_d ELSE 0 END), 0))::real::text
          AS attestation_efficiency_d,
        (SUM(merged_snapshot.attestation_efficiency_w * merged_snapshot.attestation_count_w) / NULLIF(SUM(CASE WHEN merged_snapshot.attestation_efficiency_w IS NOT NULL THEN merged_snapshot.attestation_count_w ELSE 0 END), 0))::real::text
          AS attestation_efficiency_w,
        (SUM(merged_snapshot.attestation_efficiency_m * merged_snapshot.attestation_count_m) / NULLIF(SUM(CASE WHEN merged_snapshot.attestation_efficiency_m IS NOT NULL THEN merged_snapshot.attestation_count_m ELSE 0 END), 0))::real::text
          AS attestation_efficiency_m,
        -- Weighted attestation delay (by attestation count per timeframe)
        (SUM(merged_snapshot.avg_attestation_delay_d * merged_snapshot.attestation_count_d) / NULLIF(SUM(CASE WHEN merged_snapshot.avg_attestation_delay_d IS NOT NULL THEN merged_snapshot.attestation_count_d ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_d,
        (SUM(merged_snapshot.avg_attestation_delay_w * merged_snapshot.attestation_count_w) / NULLIF(SUM(CASE WHEN merged_snapshot.avg_attestation_delay_w IS NOT NULL THEN merged_snapshot.attestation_count_w ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_w,
        (SUM(merged_snapshot.avg_attestation_delay_m * merged_snapshot.attestation_count_m) / NULLIF(SUM(CASE WHEN merged_snapshot.avg_attestation_delay_m IS NOT NULL THEN merged_snapshot.attestation_count_m ELSE 0 END), 0))::real::text
          AS avg_attestation_delay_m,
        -- Beacon status breakdown as JSON
        COALESCE(
          (SELECT json_object_agg(bs, cnt)::text
           FROM (
             SELECT merged_snapshot.beacon_status::text AS bs, COUNT(*)::int AS cnt
             FROM merged_snapshot
             WHERE merged_snapshot.beacon_status IS NOT NULL
             GROUP BY merged_snapshot.beacon_status
           ) sub),
          '{}'
        ) AS beacon_status_breakdown
      FROM merged_snapshot
    `;

    return rows[0] ?? null;
  }

  /**
   * Get all unique validator indexes across all clusters for an owner
   */
  async findAllValidatorIndexesByOwner(ownerId: string): Promise<number[]> {
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
   * Remove Lido validators and clear the cluster operator id in one transaction.
   */
  async clearLidoOperatorFromOwnedCluster(
    clusterId: string,
    ownerId: string,
    validatorIndexes: number[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const removedValidatorCount =
        validatorIndexes.length === 0
          ? 0
          : (
              await tx.clusterValidator.deleteMany({
                where: {
                  cluster: { id: clusterId, ownerId },
                  validatorIndex: { in: validatorIndexes },
                },
              })
            ).count;

      const cluster = await tx.cluster.update({
        where: { id: clusterId, ownerId },
        data: { lidoOperatorId: null },
        select: { id: true, lidoOperatorId: true },
      });

      return { cluster, removedValidatorCount };
    });
  }

  /**
   * Check if cluster exists and belongs to owner
   */
  async existsForOwner(id: string, ownerId: string): Promise<boolean> {
    const cluster = await this.prisma.cluster.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    return cluster !== null;
  }
}
