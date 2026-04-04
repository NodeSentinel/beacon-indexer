import { PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

/**
 * AnalyticsStorage - Database persistence layer for analytics queries
 * Uses raw SQL for aggregated missed attestation data
 */
export class AnalyticsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Get missed attestations from the snapshot table (1h data)
   * Reads pre-computed missed_attestation_slots_h arrays, unnests, and groups by epoch
   */
  async getMissedAttestationsFromSnapshot(
    validatorIndexes: number[],
    slotsPerEpoch: number,
  ): Promise<Array<{ epoch: number; count: bigint; validator_count: bigint }>> {
    if (validatorIndexes.length === 0) {
      return [];
    }

    // slotsPerEpoch must be a literal (not a $N parameter) because PostgreSQL
    // requires GROUP BY expressions to match SELECT expressions exactly.
    return this.prisma.$queryRawUnsafe<
      Array<{ epoch: number; count: bigint; validator_count: bigint }>
    >(
      `SELECT
        (s.slot / ${slotsPerEpoch})::int AS epoch,
        COUNT(*)::bigint AS count,
        COUNT(DISTINCT vss.validator_index)::bigint AS validator_count
      FROM validators_snapshot_stats vss
      CROSS JOIN LATERAL unnest(vss.missed_attestation_slots_h) AS s(slot)
      WHERE vss.validator_index = ANY($1::int[])
      GROUP BY (s.slot / ${slotsPerEpoch})
      ORDER BY epoch ASC`,
      validatorIndexes,
    );
  }

  /**
   * Get per-epoch rewards from the epoch_rewards table (1h data)
   * Aggregates head/target/source/inactivity and missed across all given validators, grouped by epoch
   */
  async getRewardsFromEpochRewards(
    validatorIndexes: number[],
    fromEpoch: number,
  ): Promise<
    Array<{
      epoch: number;
      head: bigint;
      target: bigint;
      source: bigint;
      inactivity: bigint;
      missed: bigint;
    }>
  > {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRaw<
      Array<{
        epoch: number;
        head: bigint;
        target: bigint;
        source: bigint;
        inactivity: bigint;
        missed: bigint;
      }>
    >`
      SELECT
        er.epoch,
        SUM(er.head)::bigint AS head,
        SUM(er.target)::bigint AS target,
        SUM(er.source)::bigint AS source,
        SUM(er.inactivity)::bigint AS inactivity,
        (SUM(er.missed_head) + SUM(er.missed_target) + SUM(er.missed_source) + SUM(er.missed_inactivity))::bigint AS missed
      FROM epoch_rewards er
      WHERE er.validator_index = ANY(${validatorIndexes})
        AND er.epoch >= ${fromEpoch}
      GROUP BY er.epoch
      ORDER BY er.epoch ASC
    `;
  }

  /**
   * Get sync committee rewards aggregated by epoch (derived from slot-level data)
   * Groups slot rewards into epochs using slotsPerEpoch
   */
  async getSyncRewardsFromSlots(
    validatorIndexes: number[],
    fromSlot: number,
    slotsPerEpoch: number,
  ): Promise<Array<{ epoch: number; sync_reward: bigint }>> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRawUnsafe<Array<{ epoch: number; sync_reward: bigint }>>(
      `SELECT
        (vsr.slot / ${slotsPerEpoch})::int AS epoch,
        SUM(vsr.sync_committee)::bigint AS sync_reward
      FROM validator_sync_rewards vsr
      WHERE vsr.validator_index = ANY($1::int[])
        AND vsr.slot >= $2
      GROUP BY (vsr.slot / ${slotsPerEpoch})
      ORDER BY epoch ASC`,
      validatorIndexes,
      fromSlot,
    );
  }

  /**
   * Get block proposal rewards from the slot table (1h data)
   * Returns consensus_reward and execution_reward grouped by epoch for proposers in the validator set
   */
  async getBlockRewardsFromSlots(
    validatorIndexes: number[],
    fromSlot: number,
    slotsPerEpoch: number,
  ): Promise<Array<{ epoch: number; block_consensus: bigint; block_execution: bigint }>> {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRawUnsafe<
      Array<{ epoch: number; block_consensus: bigint; block_execution: bigint }>
    >(
      `SELECT
        (s.slot / ${slotsPerEpoch})::int AS epoch,
        COALESCE(SUM(s.consensus_reward), 0)::bigint AS block_consensus,
        COALESCE(SUM(s.execution_reward), 0)::bigint AS block_execution
      FROM slot s
      WHERE s.proposer_index = ANY($1::int[])
        AND s.slot >= $2
        AND (s.consensus_reward IS NOT NULL OR s.execution_reward IS NOT NULL)
      GROUP BY (s.slot / ${slotsPerEpoch})
      ORDER BY epoch ASC`,
      validatorIndexes,
      fromSlot,
    );
  }

  /**
   * Get rewards from the validator_hourly_archive table (24h data)
   * Returns aggregate CL rewards, missed rewards, sync rewards, and block rewards per hour
   */
  async getRewardsFromArchive(
    validatorIndexes: number[],
    fromTimestamp: Date,
  ): Promise<
    Array<{
      timestamp: Date;
      cl_reward: bigint;
      cl_missed: bigint;
      sync_reward: bigint;
      block_reward: bigint;
      exec_reward: bigint;
    }>
  > {
    if (validatorIndexes.length === 0) return [];

    return this.prisma.$queryRaw<
      Array<{
        timestamp: Date;
        cl_reward: bigint;
        cl_missed: bigint;
        sync_reward: bigint;
        block_reward: bigint;
        exec_reward: bigint;
      }>
    >`
      SELECT
        vha.timestamp,
        SUM(vha.cl_reward_total)::bigint AS cl_reward,
        SUM(vha.cl_missed_reward_total)::bigint AS cl_missed,
        SUM(vha.sync_reward_total)::bigint AS sync_reward,
        COALESCE(SUM(vha.block_reward_total), 0)::bigint AS block_reward,
        COALESCE(SUM(vha.exec_reward_total), 0)::bigint AS exec_reward
      FROM validator_hourly_archive vha
      WHERE vha.validator_index = ANY(${validatorIndexes})
        AND vha.timestamp >= ${fromTimestamp}
      GROUP BY vha.timestamp
      ORDER BY vha.timestamp ASC
    `;
  }

  /**
   * Get missed attestations from the validator_hourly_archive table (historical data)
   * Groups by timestamp and sums missed attestation counts
   */
  async getMissedAttestationsFromArchive(
    validatorIndexes: number[],
    fromTimestamp: Date,
  ): Promise<Array<{ timestamp: Date; count: bigint; validator_count: bigint }>> {
    if (validatorIndexes.length === 0) {
      return [];
    }

    return this.prisma.$queryRaw<
      Array<{ timestamp: Date; count: bigint; validator_count: bigint }>
    >`
      SELECT
        vha.timestamp,
        COALESCE(SUM(vha.missed_attestation_count), 0)::bigint AS count,
        COUNT(DISTINCT vha.validator_index)::bigint AS validator_count
      FROM validator_hourly_archive vha
      WHERE vha.validator_index = ANY(${validatorIndexes})
        AND vha.timestamp >= ${fromTimestamp}
        AND vha.missed_attestation_count > 0
      GROUP BY vha.timestamp
      ORDER BY vha.timestamp ASC
    `;
  }
}
