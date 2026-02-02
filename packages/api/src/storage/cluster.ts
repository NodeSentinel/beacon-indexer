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
   * Find cluster by ID with validators
   */
  async findByIdWithValidators(id: string) {
    return this.prisma.cluster.findUnique({
      where: { id },
      include: {
        validators: {
          select: { validatorIndex: true },
        },
      },
    });
  }

  /**
   * Get unique withdrawal addresses from validators in a cluster
   * Extracts addresses from withdrawal_credentials (0x01 prefix format)
   */
  async getWithdrawalAddresses(clusterId: string): Promise<string[]> {
    const validators = await this.prisma.clusterValidator.findMany({
      where: { clusterId },
      include: {
        validator: {
          select: { withdrawalAddress: true },
        },
      },
    });

    const addresses = new Set<string>();
    for (const cv of validators) {
      const addr = cv.validator.withdrawalAddress;
      if (addr) {
        addresses.add(addr);
      }
    }
    return Array.from(addresses);
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
