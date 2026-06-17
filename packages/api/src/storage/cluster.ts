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

interface ClusterSummaryMetric {
  total: number;
  totalUniqueValidators: number;
  totalEffectiveBalance: bigint;
}

type NumericQueryValue = bigint | number | string | { toString(): string };

interface ClusterSummaryQueryRow {
  total_clusters: NumericQueryValue;
  active_total: NumericQueryValue;
  active_unique_validators: NumericQueryValue;
  active_effective_balance: NumericQueryValue;
  telegram_total: NumericQueryValue;
  telegram_unique_validators: NumericQueryValue;
  telegram_effective_balance: NumericQueryValue;
  lido_total: NumericQueryValue;
  lido_unique_validators: NumericQueryValue;
  lido_effective_balance: NumericQueryValue;
  annon_total: NumericQueryValue;
  annon_unique_validators: NumericQueryValue;
  annon_effective_balance: NumericQueryValue;
  blocked_total: NumericQueryValue;
  blocked_unique_validators: NumericQueryValue;
  blocked_effective_balance: NumericQueryValue;
  inactive_annon: NumericQueryValue;
  inactive_tg: NumericQueryValue;
  cluster_id: string | null;
  cluster_name: string | null;
  cluster_owner_id: string | null;
  cluster_owner_username: string | null;
  cluster_validator_count: NumericQueryValue | null;
  cluster_effective_balance: NumericQueryValue | null;
}

/**
 * Converts count values from raw SQL into JavaScript numbers.
 */
function queryNumber(value: NumericQueryValue | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * Converts bigint-like raw SQL values into bigint storage totals.
 */
function queryBigInt(value: NumericQueryValue | null | undefined): bigint {
  return BigInt((value ?? 0).toString());
}

/**
 * Builds one storage summary metric from raw SQL aggregate columns.
 */
function createQueryMetric(params: {
  total: NumericQueryValue;
  totalUniqueValidators: NumericQueryValue;
  totalEffectiveBalance: NumericQueryValue;
}): ClusterSummaryMetric {
  return {
    total: queryNumber(params.total),
    totalUniqueValidators: queryNumber(params.totalUniqueValidators),
    totalEffectiveBalance: queryBigInt(params.totalEffectiveBalance),
  };
}

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
   * Lists one owner's clusters with validator details for API-key inspection.
   */
  async listWithValidatorsByOwner(ownerId: string) {
    return this.prisma.cluster.findMany({
      where: { ownerId },
      include: {
        validators: {
          orderBy: { validatorIndex: 'asc' },
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a cross-user summary of clusters and validator membership counts.
   */
  async getSummary() {
    const rows = await this.prisma.$queryRaw<ClusterSummaryQueryRow[]>(Prisma.sql`
      WITH cluster_memberships AS (
        SELECT
          c.id AS cluster_id,
          c.name AS cluster_name,
          c.owner_id AS cluster_owner_id,
          c.created_at AS cluster_created_at,
          c.lido_operator_id AS cluster_lido_operator_id,
          CASE WHEN u.telegram_id IS NULL THEN 'annon' ELSE u.username END AS cluster_owner_username,
          u.telegram_id AS owner_telegram_id,
          u.has_blocked_bot AS owner_has_blocked_bot,
          cv.validator_index AS validator_index,
          COALESCE(v.effective_balance, 0)::bigint AS effective_balance
        FROM "cluster" c
        INNER JOIN "user" u ON u.id = c.owner_id
        LEFT JOIN "cluster_validator" cv ON cv.cluster_id = c.id
        LEFT JOIN "validator" v ON v.id = cv.validator_index
      ),
      cluster_summaries AS (
        SELECT
          cluster_id,
          cluster_name,
          cluster_owner_id,
          cluster_created_at,
          cluster_owner_username,
          COUNT(validator_index)::bigint AS cluster_validator_count,
          COALESCE(SUM(effective_balance), 0)::bigint AS cluster_effective_balance
        FROM cluster_memberships
        GROUP BY
          cluster_id,
          cluster_name,
          cluster_owner_id,
          cluster_created_at,
          cluster_owner_username
      ),
      active_memberships AS (
        SELECT *
        FROM cluster_memberships
        WHERE
          validator_index IS NOT NULL
          AND NOT (owner_telegram_id IS NOT NULL AND owner_has_blocked_bot)
      ),
      blocked_memberships AS (
        SELECT *
        FROM cluster_memberships
        WHERE
          validator_index IS NOT NULL
          AND owner_telegram_id IS NOT NULL
          AND owner_has_blocked_bot
      ),
      inactive_users AS (
        SELECT
          COUNT(*) FILTER (WHERE u.telegram_id IS NULL)::bigint AS inactive_annon,
          COUNT(*) FILTER (WHERE u.telegram_id IS NOT NULL)::bigint AS inactive_tg
        FROM "user" u
        WHERE NOT EXISTS (
          SELECT 1
          FROM "cluster" c
          INNER JOIN "cluster_validator" cv ON cv.cluster_id = c.id
          WHERE c.owner_id = u.id
        )
      ),
      summary AS (
        SELECT
          (SELECT COUNT(*)::bigint FROM "cluster") AS total_clusters,
          (SELECT COUNT(DISTINCT cluster_owner_id)::bigint FROM active_memberships) AS active_total,
          (SELECT COUNT(DISTINCT validator_index)::bigint FROM active_memberships) AS active_unique_validators,
          (SELECT COALESCE(SUM(effective_balance), 0)::bigint FROM active_memberships) AS active_effective_balance,
          (SELECT COUNT(DISTINCT cluster_owner_id)::bigint FROM active_memberships WHERE owner_telegram_id IS NOT NULL) AS telegram_total,
          (SELECT COUNT(DISTINCT validator_index)::bigint FROM active_memberships WHERE owner_telegram_id IS NOT NULL) AS telegram_unique_validators,
          (SELECT COALESCE(SUM(effective_balance), 0)::bigint FROM active_memberships WHERE owner_telegram_id IS NOT NULL) AS telegram_effective_balance,
          (SELECT COUNT(DISTINCT cluster_owner_id)::bigint FROM active_memberships WHERE cluster_lido_operator_id IS NOT NULL) AS lido_total,
          (SELECT COUNT(DISTINCT validator_index)::bigint FROM active_memberships WHERE cluster_lido_operator_id IS NOT NULL) AS lido_unique_validators,
          (SELECT COALESCE(SUM(effective_balance), 0)::bigint FROM active_memberships WHERE cluster_lido_operator_id IS NOT NULL) AS lido_effective_balance,
          (SELECT COUNT(DISTINCT cluster_owner_id)::bigint FROM active_memberships WHERE owner_telegram_id IS NULL) AS annon_total,
          (SELECT COUNT(DISTINCT validator_index)::bigint FROM active_memberships WHERE owner_telegram_id IS NULL) AS annon_unique_validators,
          (SELECT COALESCE(SUM(effective_balance), 0)::bigint FROM active_memberships WHERE owner_telegram_id IS NULL) AS annon_effective_balance,
          (SELECT COUNT(DISTINCT cluster_owner_id)::bigint FROM blocked_memberships) AS blocked_total,
          (SELECT COUNT(DISTINCT validator_index)::bigint FROM blocked_memberships) AS blocked_unique_validators,
          (SELECT COALESCE(SUM(effective_balance), 0)::bigint FROM blocked_memberships) AS blocked_effective_balance,
          inactive_users.inactive_annon,
          inactive_users.inactive_tg
        FROM inactive_users
      )
      SELECT
        summary.total_clusters,
        summary.active_total,
        summary.active_unique_validators,
        summary.active_effective_balance,
        summary.telegram_total,
        summary.telegram_unique_validators,
        summary.telegram_effective_balance,
        summary.lido_total,
        summary.lido_unique_validators,
        summary.lido_effective_balance,
        summary.annon_total,
        summary.annon_unique_validators,
        summary.annon_effective_balance,
        summary.blocked_total,
        summary.blocked_unique_validators,
        summary.blocked_effective_balance,
        summary.inactive_annon,
        summary.inactive_tg,
        cluster_summaries.cluster_id,
        cluster_summaries.cluster_name,
        cluster_summaries.cluster_owner_id,
        cluster_summaries.cluster_owner_username,
        cluster_summaries.cluster_validator_count,
        cluster_summaries.cluster_effective_balance
      FROM summary
      LEFT JOIN cluster_summaries ON TRUE
      ORDER BY cluster_summaries.cluster_created_at DESC NULLS LAST
    `);

    const summaryRow = rows[0];

    if (summaryRow === undefined) {
      throw new Error('Cluster summary query returned no rows');
    }

    const clusterSummaries = rows.flatMap((row) => {
      if (row.cluster_id === null) {
        return [];
      }

      return [
        {
          id: row.cluster_id,
          name: row.cluster_name ?? '',
          ownerId: row.cluster_owner_id ?? '',
          ownerUsername: row.cluster_owner_username ?? 'annon',
          validatorCount: queryNumber(row.cluster_validator_count),
          effectiveBalance: queryBigInt(row.cluster_effective_balance),
        },
      ];
    });

    const inactiveAnnon = queryNumber(summaryRow.inactive_annon);
    const inactiveTg = queryNumber(summaryRow.inactive_tg);

    return {
      totalClusters: queryNumber(summaryRow.total_clusters),
      activeUsers: {
        ...createQueryMetric({
          total: summaryRow.active_total,
          totalUniqueValidators: summaryRow.active_unique_validators,
          totalEffectiveBalance: summaryRow.active_effective_balance,
        }),
        details: {
          telegram: createQueryMetric({
            total: summaryRow.telegram_total,
            totalUniqueValidators: summaryRow.telegram_unique_validators,
            totalEffectiveBalance: summaryRow.telegram_effective_balance,
          }),
          lido: createQueryMetric({
            total: summaryRow.lido_total,
            totalUniqueValidators: summaryRow.lido_unique_validators,
            totalEffectiveBalance: summaryRow.lido_effective_balance,
          }),
          annon: createQueryMetric({
            total: summaryRow.annon_total,
            totalUniqueValidators: summaryRow.annon_unique_validators,
            totalEffectiveBalance: summaryRow.annon_effective_balance,
          }),
        },
      },
      tgBlockedUsers: createQueryMetric({
        total: summaryRow.blocked_total,
        totalUniqueValidators: summaryRow.blocked_unique_validators,
        totalEffectiveBalance: summaryRow.blocked_effective_balance,
      }),
      inactiveUsers: {
        total: inactiveAnnon + inactiveTg,
        annon: inactiveAnnon,
        tg: inactiveTg,
      },
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
