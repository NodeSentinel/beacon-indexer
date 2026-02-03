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
   * Find cluster by ID with validators and their withdrawal addresses
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
              select: { withdrawalAddress: true },
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
