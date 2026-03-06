import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * ValidatorStorage - Database persistence layer for validator-related operations
 * Handles all database operations using raw SQL queries for performance
 * No business logic here - only data access
 */

interface ValidatorInfoRow {
  id: number;
  pubkey: string | null;
  withdrawal_address: string | null;
  status: number | null;
  balance: bigint;
  effective_balance: bigint | null;
}

interface PerformanceSummaryRow {
  attestations_total: number;
  attestations_missed: number;
  performance: number;
}

interface SlotRow {
  slot: number;
  index: number; // indexInEpoch
  aggregation_bits_index: number;
  attestation_delay: number | null;
  block_reward: string | null;
  sync_committee: string | null;
}

interface EpochRewardsRow {
  epoch: number;
  head: bigint;
  target: bigint;
  source: bigint;
  inactivity: bigint;
  missed_head: bigint;
  missed_target: bigint;
  missed_source: bigint;
  missed_inactivity: bigint;
}

export class ValidatorStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Resolve validator index from pubkey
   * @param pubkey - Validator public key (98 chars)
   * @returns Validator index or null if not found
   */
  async resolveValidatorIndex(pubkey: string): Promise<number | null> {
    const result = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM validator
      WHERE pubkey = ${pubkey}
      LIMIT 1
    `;

    return result[0]?.id ?? null;
  }

  /**
   * Get validator basic info
   * @param validatorIndex - Validator index
   * @returns Validator info row or null if not found
   */
  async getValidatorInfo(validatorIndex: number): Promise<ValidatorInfoRow | null> {
    const result = await this.prisma.$queryRaw<ValidatorInfoRow[]>`
      SELECT
        id,
        pubkey,
        withdrawal_address,
        status,
        balance,
        effective_balance
      FROM validator
      WHERE id = ${validatorIndex}
      LIMIT 1
    `;

    return result[0] ?? null;
  }

  /**
   * Get performance summary from validators_snapshot_stats table
   * Falls back to computing from committee table if summary not available
   * @param validatorIndex - Validator index
   * @param maxAttestationDelay - Maximum delay threshold
   * @returns Performance summary row
   */
  async getPerformanceSummary(
    validatorIndex: number,
    maxAttestationDelay: number,
  ): Promise<PerformanceSummaryRow> {
    // Try to get from summary table first
    const summaryResult = await this.prisma.$queryRaw<Array<PerformanceSummaryRow>>`
      SELECT
        attestations_total,
        attestations_missed,
        performance::numeric AS performance
      FROM validators_snapshot_stats
      WHERE validator_index = ${validatorIndex}
      LIMIT 1
    `;

    if (summaryResult[0]) {
      return summaryResult[0];
    }

    // Fallback: compute from committee table (all data, no slot filter)
    const computedResult = await this.prisma.$queryRaw<Array<PerformanceSummaryRow>>`
      SELECT
        COUNT(*)::int AS attestations_total,
        COUNT(*) FILTER (
          WHERE attestation_delay IS NULL OR attestation_delay > ${maxAttestationDelay}::smallint
        )::int AS attestations_missed,
        CASE
          WHEN COUNT(*) > 0
          THEN ((COUNT(*) - COUNT(*) FILTER (
            WHERE attestation_delay IS NULL OR attestation_delay > ${maxAttestationDelay}::smallint
          ))::float / COUNT(*) * 100)::numeric(5, 2)
          ELSE 0.0
        END AS performance
      FROM committee
      WHERE validator_index = ${validatorIndex}
    `;

    return (
      computedResult[0] ?? {
        attestations_total: 0,
        attestations_missed: 0,
        performance: 0,
      }
    );
  }

  /**
   * Get timeline slots with attestations and rewards (all data, no slot filter)
   * @param validatorIndex - Validator index
   * @returns Array of slot rows
   */
  async getTimelineSlots(validatorIndex: number): Promise<SlotRow[]> {
    const result = await this.prisma.$queryRaw<SlotRow[]>`
      SELECT
        c.slot,
        c.index,
        c.aggregation_bits_index,
        c.attestation_delay,
        s.consensus_reward::text AS block_reward,
        vsr.sync_committee::text AS sync_committee
      FROM committee c
      LEFT JOIN slot s
        ON s.slot = c.slot
        AND s.proposer_index = c.validator_index
      LEFT JOIN validator_sync_rewards vsr
        ON vsr.validator_index = c.validator_index
        AND vsr.slot = c.slot
      WHERE c.validator_index = ${validatorIndex}::int
      ORDER BY c.slot DESC
    `;

    return result;
  }

  /**
   * Get epoch rewards for a validator (all data, no epoch filter)
   * @param validatorIndex - Validator index
   * @returns Array of epoch rewards rows
   */
  async getEpochRewards(validatorIndex: number): Promise<EpochRewardsRow[]> {
    const result = await this.prisma.$queryRaw<EpochRewardsRow[]>`
      SELECT
        epoch,
        head,
        target,
        source,
        inactivity,
        missed_head,
        missed_target,
        missed_source,
        missed_inactivity
      FROM epoch_rewards
      WHERE validator_index = ${validatorIndex}::int
      ORDER BY epoch DESC
    `;

    return result;
  }

  /**
   * Search validators by withdrawal address
   * @param withdrawalAddress - Withdrawal address (0x prefixed, 42 chars)
   * @returns Array of validators with basic info
   */
  async findByWithdrawalAddress(
    withdrawalAddress: string,
  ): Promise<Array<{ index: number; pubkey: string | null; withdrawalAddress: string | null }>> {
    const validators = await this.prisma.validator.findMany({
      where: { withdrawalAddress: withdrawalAddress.toLowerCase() },
      select: { id: true, pubkey: true, withdrawalAddress: true },
      orderBy: { id: 'asc' },
    });

    return validators.map((v) => ({
      index: v.id,
      pubkey: v.pubkey,
      withdrawalAddress: v.withdrawalAddress,
    }));
  }

  /**
   * Check if validator exists by index
   * @param validatorIndex - Validator index
   * @returns Validator basic info or null if not found
   */
  async existsByIndex(
    validatorIndex: number,
  ): Promise<{ index: number; pubkey: string | null; withdrawalAddress: string | null } | null> {
    const validator = await this.prisma.validator.findUnique({
      where: { id: validatorIndex },
      select: { id: true, pubkey: true, withdrawalAddress: true },
    });

    if (!validator) return null;
    return {
      index: validator.id,
      pubkey: validator.pubkey,
      withdrawalAddress: validator.withdrawalAddress,
    };
  }

  /**
   * Check if validators exist by multiple indexes (bulk)
   * @param validatorIndexes - Array of validator indexes
   * @returns Array of validators with basic info (only found ones)
   */
  async existsByIndexes(
    validatorIndexes: number[],
  ): Promise<Array<{ index: number; pubkey: string | null; withdrawalAddress: string | null }>> {
    if (validatorIndexes.length === 0) return [];

    const validators = await this.prisma.validator.findMany({
      where: { id: { in: validatorIndexes } },
      select: { id: true, pubkey: true, withdrawalAddress: true },
      orderBy: { id: 'asc' },
    });

    return validators.map((v) => ({
      index: v.id,
      pubkey: v.pubkey,
      withdrawalAddress: v.withdrawalAddress,
    }));
  }

  /**
   * Search validators by multiple pubkeys (bulk)
   * @param pubkeys - Array of pubkeys
   * @returns Array of validators with basic info
   */
  async findByPubkeys(
    pubkeys: string[],
  ): Promise<Array<{ index: number; pubkey: string; withdrawalAddress: string | null }>> {
    if (pubkeys.length === 0) return [];

    const validators = await this.prisma.validator.findMany({
      where: { pubkey: { in: pubkeys } },
      select: { id: true, pubkey: true, withdrawalAddress: true },
      orderBy: { id: 'asc' },
    });

    return validators
      .filter((v) => v.pubkey !== null)
      .map((v) => ({
        index: v.id,
        pubkey: v.pubkey!,
        withdrawalAddress: v.withdrawalAddress,
      }));
  }

  /**
   * Search validators by multiple withdrawal addresses (bulk)
   * @param withdrawalAddresses - Array of withdrawal addresses
   * @returns Array of validators with basic info
   */
  async findByWithdrawalAddresses(
    withdrawalAddresses: string[],
  ): Promise<Array<{ index: number; pubkey: string | null; withdrawalAddress: string | null }>> {
    if (withdrawalAddresses.length === 0) return [];

    const lowerAddresses = withdrawalAddresses.map((a) => a.toLowerCase());
    const validators = await this.prisma.validator.findMany({
      where: { withdrawalAddress: { in: lowerAddresses } },
      select: { id: true, pubkey: true, withdrawalAddress: true },
      orderBy: { id: 'asc' },
    });

    return validators.map((v) => ({
      index: v.id,
      pubkey: v.pubkey,
      withdrawalAddress: v.withdrawalAddress,
    }));
  }

  /**
   * Search validator by pubkey
   * @param pubkey - Validator pubkey (0x prefixed, 98 chars)
   * @returns Validator basic info or null if not found
   */
  async findByPubkey(
    pubkey: string,
  ): Promise<{ index: number; pubkey: string; withdrawalAddress: string | null } | null> {
    const validator = await this.prisma.validator.findFirst({
      where: { pubkey },
      select: { id: true, pubkey: true, withdrawalAddress: true },
    });

    if (!validator || !validator.pubkey) return null;
    return {
      index: validator.id,
      pubkey: validator.pubkey,
      withdrawalAddress: validator.withdrawalAddress,
    };
  }
}
