import { PrismaClient } from '@beacon-indexer/db';
import ms from 'ms';

/**
 * HourlyArchiveStorage - Database persistence layer for hourly archive operations.
 *
 * This class handles all database operations for the hourly archive feature,
 * following the principle that storage classes should only contain persistence
 * logic, not business logic. All data transformation, validation, and coordination
 * happens in the controller layer.
 */
export class HourlyArchiveStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check if an archive already exists for a specific UTC hour.
   * Uses the master archive table instead of querying validator_hourly_archive partitions.
   *
   * @param timestamp - UTC hour timestamp (floored to hour)
   * @returns True if the hour has been archived (lastHour >= timestamp)
   */
  async archiveExistsForHour(timestamp: Date): Promise<boolean> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: 1 },
      select: { lastHour: true },
    });

    if (!archive?.lastHour) {
      return false;
    }

    // Already archived if lastHour >= target hour
    return archive.lastHour >= timestamp;
  }

  /**
   * Check if all slots in a range have been fully processed.
   * Since slots are processed sequentially, we only need to check the last slot.
   * If the last slot is processed, all previous slots are also processed.
   *
   * @param startSlot - First slot in range (inclusive)
   * @param endSlot - Last slot in range (inclusive)
   * @returns True if all slots are processed
   */
  async allSlotsProcessed(startSlot: number, endSlot: number): Promise<boolean> {
    const slot = await this.prisma.slot.findUnique({
      where: { slot: endSlot },
      select: { processed: true },
    });

    return slot?.processed ?? false;
  }

  /**
   * Check if all epochs in a range have been fully processed.
   * Since epochs are processed sequentially, we only need to check the last epoch.
   * If the last epoch is processed, all previous epochs are also processed.
   *
   * @param startEpoch - First epoch in range (inclusive)
   * @param endEpoch - Last epoch in range (inclusive)
   * @returns True if all epochs are processed
   */
  async allEpochsProcessed(startEpoch: number, endEpoch: number): Promise<boolean> {
    const epoch = await this.prisma.epoch.findUnique({
      where: { epoch: endEpoch },
      select: { processed: true },
    });

    return epoch?.processed ?? false;
  }

  /**
   * Update the lastHour timestamp in the archive master table.
   * This marks that the given hour has been successfully archived.
   *
   * @param timestamp - UTC hour timestamp that was archived
   */
  async updateLastHour(timestamp: Date): Promise<void> {
    await this.prisma.archive.update({
      where: { id: 1 },
      data: { lastHour: timestamp },
    });
  }

  /**
   * Execute archive + partition drops atomically in a single transaction.
   *
   * This method:
   * 1. Creates the hourly archive partition (if needed)
   * 2. Aggregates data into hourly archive
   * 3. Drops committee partition
   * 4. Drops epoch_rewards partition
   *
   * All operations run in a single transaction - if any fails, all are rolled back.
   * Uses SET LOCAL statement_timeout which only affects the current transaction.
   *
   * @param timestamp - UTC hour timestamp
   * @param startSlot - First slot in the hour (inclusive)
   * @param endSlot - Last slot in the hour (inclusive)
   * @param startEpoch - First epoch in the hour (inclusive)
   * @param endEpoch - Last epoch in the hour (inclusive)
   * @param maxAttestationDelay - Attestations with delay > this are considered missed
   * @param hourlyArchivePartitionName - Exact name of the hourly archive partition to create
   * @param committeePartitionName - Exact name of the committee partition to drop
   * @param epochRewardsPartitionName - Exact name of the epoch_rewards partition to drop
   */
  async archiveHourAtomically(
    timestamp: Date,
    startSlot: number,
    endSlot: number,
    startEpoch: number,
    endEpoch: number,
    maxAttestationDelay: number,
    hourlyArchivePartitionName: string,
    committeePartitionName: string,
    epochRewardsPartitionName: string,
  ): Promise<void> {
    // Use Prisma interactive transaction for atomicity
    await this.prisma.$transaction(
      async (tx) => {
        // Create hourly archive partition (idempotent via IF NOT EXISTS)
        const partitionName = hourlyArchivePartitionName;
        const nextHourTimestamp = new Date(timestamp.getTime() + 3600000);
        await tx.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "validator_hourly_archive" ` +
            `FOR VALUES FROM ('${timestamp.toISOString()}') TO ('${nextHourTimestamp.toISOString()}')`,
        );

        // Execute aggregation
        await tx.$executeRaw`
          WITH
            attestations AS (
              SELECT
                c.validator_index,
                c.slot,
                c.attestation_delay
              FROM committee c
              WHERE c.slot >= ${startSlot}::int AND c.slot <= ${endSlot}::int
            ),

            sync_rewards AS (
              SELECT
                validator_index,
                slot,
                sync_committee_reward
              FROM sync_committee_rewards
              WHERE slot >= ${startSlot}::int AND slot <= ${endSlot}::int
            ),

            block_rewards AS (
              SELECT
                proposer_index AS validator_index,
                slot,
                consensus_reward AS block_reward
              FROM slot
              WHERE slot >= ${startSlot}::int AND slot <= ${endSlot}::int
                AND proposer_index IS NOT NULL
                AND consensus_reward IS NOT NULL
                AND consensus_reward > 0
            ),

            exec_rewards AS (
              SELECT
                proposer_index AS validator_index,
                slot,
                execution_reward
              FROM slot
              WHERE slot >= ${startSlot}::int AND slot <= ${endSlot}::int
                AND proposer_index IS NOT NULL
                AND execution_reward IS NOT NULL
                AND execution_reward > 0
            ),

            slot_data AS (
              SELECT
                validator_index,
                slot,
                MAX(attestation_delay) AS attestation_delay,
                MAX(sync_committee_reward)::bigint AS sync_reward,
                MAX(execution_reward) AS exec_reward,
                MAX(block_reward)::bigint AS block_reward
              FROM (
                SELECT validator_index, slot, attestation_delay, NULL::bigint AS sync_committee_reward, NULL::numeric AS execution_reward, NULL::bigint AS block_reward
                FROM attestations
                UNION ALL
                SELECT validator_index, slot, NULL::int, sync_committee_reward, NULL::numeric, NULL::bigint
                FROM sync_rewards
                UNION ALL
                SELECT validator_index, slot, NULL::int, NULL::bigint, execution_reward, NULL::bigint
                FROM exec_rewards
                UNION ALL
                SELECT validator_index, slot, NULL::int, NULL::bigint, NULL::numeric, block_reward
                FROM block_rewards
              ) combined
              GROUP BY validator_index, slot
            ),

            attestation_agg AS (
              SELECT
                validator_index,
                COUNT(*) FILTER (WHERE attestation_delay IS NOT NULL AND attestation_delay <= ${maxAttestationDelay}::int) AS attestation_count,
                COUNT(*) FILTER (WHERE attestation_delay IS NULL OR attestation_delay > ${maxAttestationDelay}::int) AS missed_attestation_count
              FROM attestations
              GROUP BY validator_index
            ),

            slot_agg AS (
              SELECT
                validator_index,
                jsonb_agg(
                  jsonb_build_array(
                    slot,
                    COALESCE(attestation_delay, -1)
                  ) || CASE
                    WHEN exec_reward IS NOT NULL OR block_reward IS NOT NULL THEN
                      jsonb_build_array(
                        COALESCE(sync_reward, 0)::text,
                        COALESCE(exec_reward, 0::numeric)::text,
                        COALESCE(block_reward, 0)::text
                      )
                    WHEN sync_reward IS NOT NULL AND sync_reward != 0 THEN
                      jsonb_build_array(sync_reward::text)
                    ELSE
                      '[]'::jsonb
                  END
                  ORDER BY slot
                ) AS data_by_slot,
                COALESCE(SUM(sync_reward), 0) AS sync_reward_total,
                NULLIF(SUM(exec_reward), 0::numeric) AS exec_reward_total,
                NULLIF(SUM(block_reward), 0) AS block_reward_total
              FROM slot_data
              GROUP BY validator_index
            ),

            epoch_data AS (
              SELECT
                validator_index,
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
              WHERE epoch >= ${startEpoch}::int AND epoch <= ${endEpoch}::int
            ),

            epoch_json AS (
              SELECT
                validator_index,
                jsonb_agg(
                  jsonb_build_array(
                    epoch,
                    head::text,
                    target::text,
                    source::text,
                    inactivity::text,
                    missed_head::text,
                    missed_target::text,
                    missed_source::text,
                    missed_inactivity::text
                  ) ORDER BY epoch
                ) AS data_by_epoch,
                SUM(head + target + source + inactivity) AS cl_reward_total,
                SUM(missed_head + missed_target + missed_source + missed_inactivity) AS cl_missed_reward_total
              FROM epoch_data
              GROUP BY validator_index
            )

          INSERT INTO validator_hourly_archive (
            timestamp,
            validator_index,
            data_by_slot,
            data_by_epoch,
            attestation_count,
            missed_attestation_count,
            sync_reward_total,
            exec_reward_total,
            block_reward_total,
            cl_reward_total,
            cl_missed_reward_total
          )
          SELECT
            ${timestamp}::timestamp AS timestamp,
            COALESCE(sa.validator_index, ej.validator_index) AS validator_index,
            COALESCE(sa.data_by_slot, '[]'::jsonb) AS data_by_slot,
            COALESCE(ej.data_by_epoch, '[]'::jsonb) AS data_by_epoch,
            COALESCE(aa.attestation_count, 0)::smallint AS attestation_count,
            NULLIF(COALESCE(aa.missed_attestation_count, 0), 0)::smallint AS missed_attestation_count,
            COALESCE(sa.sync_reward_total, 0) AS sync_reward_total,
            sa.exec_reward_total,
            sa.block_reward_total,
            COALESCE(ej.cl_reward_total, 0) AS cl_reward_total,
            COALESCE(ej.cl_missed_reward_total, 0) AS cl_missed_reward_total
          FROM slot_agg sa
          FULL OUTER JOIN epoch_json ej ON sa.validator_index = ej.validator_index
          LEFT JOIN attestation_agg aa ON COALESCE(sa.validator_index, ej.validator_index) = aa.validator_index
        `;

        // Drop committee partition
        await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${committeePartitionName}"`);

        // Drop epoch_rewards partition
        await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${epochRewardsPartitionName}"`);

        // Update archive master table to mark this hour as archived
        await tx.archive.update({
          where: { id: 1 },
          data: { lastHour: timestamp },
        });
      },
      {
        timeout: ms('5m'),
      },
    );
  }
}
