import { Prisma, PrismaClient } from '@beacon-indexer/db';

type IncidentRewardsChainTiming = {
  // Number of slots in one epoch, used to translate slot ranges into the epoch
  // ranges needed for attestation reward aggregation.
  slotsPerEpoch: number;
};

type SyncOpenIncidentRewardsParams = {
  // Furthest indexed slot whose incident rewards are allowed to be applied in
  // this run. Open incidents accrue through this slot, closed incidents stop at
  // their own closed slot even if it is earlier.
  processThroughSlot: number;
};

export class IncidentRewardsStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: IncidentRewardsChainTiming,
  ) {}

  async getLastRewardsFetchedEpoch(): Promise<number | null> {
    // The reward worker can only advance through epochs whose attestation
    // rewards are already materialized in epoch_rewards.
    const lastRewardsFetchedEpoch = await this.prisma.epoch.findFirst({
      where: { rewardsFetched: true },
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
    });

    return lastRewardsFetchedEpoch?.epoch ?? null;
  }

  async syncOpenIncidentRewards(params: SyncOpenIncidentRewardsParams): Promise<void> {
    const finalizedAt = new Date();
    const slotsPerEpoch = this.chainTiming.slotsPerEpoch;

    // Keep the reward reconciliation, cursor advancement, and closed-incident
    // finalization inside one transaction so a partial failure cannot double-apply
    // missed rewards or advance cursors ahead of incident totals.
    await this.prisma.$transaction(async (tx) => {
      // Build the whole reconciliation in SQL so the database can fan out each
      // validator's pending window across every affected incident without the
      // application pulling reward rows into memory.
      await tx.$executeRaw(
        Prisma.sql`
          WITH candidate_incidents AS (
            SELECT
              incident.id,
              incident.status,
              incident.opened_slot,
              incident.closed_slot,
              incident.validator_indexes
            FROM cluster_incident AS incident
            WHERE incident.status = 'open'::"ClusterIncidentStatus"
              OR (
                incident.status = 'closed'::"ClusterIncidentStatus"
                AND incident.rewards_finalized = FALSE
              )
          ),
          incident_validators AS (
            SELECT
              incident.id AS incident_id,
              incident.status,
              incident.opened_slot,
              incident.closed_slot,
              incident_validator.validator_index
            FROM candidate_incidents AS incident
            CROSS JOIN LATERAL unnest(incident.validator_indexes) AS incident_validator(validator_index)
          ),
          base_ranges AS (
            -- Prefer the validator's current inactive-since slot when it still
            -- exists. If the validator already recovered, fall back to the
            -- incident window so pending closed-incident rewards still finalize.
            SELECT
              incident_validators.incident_id,
              incident_validators.validator_index,
              COALESCE(
                validators_snapshot_stats.inactive_since_slot,
                incident_validators.opened_slot
              ) AS validator_start_slot,
              COALESCE(
                validators_snapshot_stats.missed_rewards_processed_through_slot,
                COALESCE(
                  validators_snapshot_stats.inactive_since_slot,
                  incident_validators.opened_slot
                ) - 1
              ) AS processed_through_slot,
              CASE
                WHEN incident_validators.status = 'closed'::"ClusterIncidentStatus"
                  AND incident_validators.closed_slot IS NOT NULL
                THEN LEAST(incident_validators.closed_slot, ${params.processThroughSlot}::int)
                ELSE ${params.processThroughSlot}::int
              END AS upper_bound
            FROM incident_validators
            JOIN validators_snapshot_stats
              ON validators_snapshot_stats.validator_index = incident_validators.validator_index
          ),
          validator_ranges AS (
            -- Each incident/validator pair gets its own pending window, while
            -- the cursor itself remains global on the validator snapshot row.
            SELECT
              base_ranges.incident_id,
              base_ranges.validator_index,
              GREATEST(
                base_ranges.validator_start_slot,
                base_ranges.processed_through_slot + 1
              ) AS lower_bound,
              base_ranges.upper_bound,
              GREATEST(
                base_ranges.validator_start_slot,
                base_ranges.processed_through_slot + 1
              ) / ${slotsPerEpoch}::int AS start_epoch,
              base_ranges.upper_bound / ${slotsPerEpoch}::int AS end_epoch
            FROM base_ranges
            WHERE GREATEST(
              base_ranges.validator_start_slot,
              base_ranges.processed_through_slot + 1
            ) <= base_ranges.upper_bound
          ),
          attestation_sums AS (
            -- Only the missed attestation columns represent rewards/penalties
            -- lost during inactivity, so earned columns stay out of the total.
            SELECT
              validator_ranges.incident_id,
              validator_ranges.validator_index,
              COALESCE(
                SUM(
                  epoch_rewards.missed_head +
                  epoch_rewards.missed_target +
                  epoch_rewards.missed_source +
                  epoch_rewards.missed_inactivity
                ),
                0
              )::bigint AS missed_rewards
            FROM validator_ranges
            LEFT JOIN epoch_rewards
              ON epoch_rewards.validator_index = validator_ranges.validator_index
              AND epoch_rewards.epoch BETWEEN validator_ranges.start_epoch AND validator_ranges.end_epoch
            GROUP BY validator_ranges.incident_id, validator_ranges.validator_index
          ),
          sync_sums AS (
            -- Sync committee rewards are slot-granular, so clip them directly
            -- to the validator's pending slot window and count only penalties.
            SELECT
              validator_ranges.incident_id,
              validator_ranges.validator_index,
              COALESCE(
                SUM(-validator_sync_rewards.sync_committee),
                0
              )::bigint AS missed_rewards
            FROM validator_ranges
            LEFT JOIN validator_sync_rewards
              ON validator_sync_rewards.validator_index = validator_ranges.validator_index
              AND validator_sync_rewards.slot BETWEEN validator_ranges.lower_bound AND validator_ranges.upper_bound
              AND validator_sync_rewards.sync_committee < 0
            GROUP BY validator_ranges.incident_id, validator_ranges.validator_index
          ),
          incident_deltas AS (
            -- Merge both reward sources back onto the incident so each cluster
            -- receives the slice of every validator window that belongs to it.
            SELECT
              validator_ranges.incident_id,
              SUM(
                COALESCE(attestation_sums.missed_rewards, 0) +
                COALESCE(sync_sums.missed_rewards, 0)
              )::bigint AS incident_delta
            FROM validator_ranges
            LEFT JOIN attestation_sums
              ON attestation_sums.incident_id = validator_ranges.incident_id
              AND attestation_sums.validator_index = validator_ranges.validator_index
            LEFT JOIN sync_sums
              ON sync_sums.incident_id = validator_ranges.incident_id
              AND sync_sums.validator_index = validator_ranges.validator_index
            GROUP BY validator_ranges.incident_id
          ),
          updated_incidents AS (
            UPDATE cluster_incident AS incident
            SET
              missed_consensus_rewards = COALESCE(incident.missed_consensus_rewards, 0) + incident_deltas.incident_delta,
              updated_at = NOW()
            FROM incident_deltas
            WHERE incident.id = incident_deltas.incident_id
              AND incident_deltas.incident_delta > 0
            RETURNING incident.id
          ),
          snapshot_advances AS (
            -- Advance each validator cursor only once to the furthest bound
            -- reached across every incident handled in this pass.
            SELECT
              validator_ranges.validator_index,
              MAX(validator_ranges.upper_bound) AS processed_through_slot
            FROM validator_ranges
            GROUP BY validator_ranges.validator_index
          ),
          updated_snapshots AS (
            UPDATE validators_snapshot_stats AS validators_snapshot_stats
            SET
              missed_rewards_processed_through_slot = GREATEST(
                COALESCE(validators_snapshot_stats.missed_rewards_processed_through_slot, -1),
                snapshot_advances.processed_through_slot
              ),
              updated_at = NOW()
            FROM snapshot_advances
            WHERE validators_snapshot_stats.validator_index = snapshot_advances.validator_index
              AND snapshot_advances.processed_through_slot >
                COALESCE(validators_snapshot_stats.missed_rewards_processed_through_slot, -1)
            RETURNING validators_snapshot_stats.validator_index
          )
          SELECT 1
        `,
      );

      // Finalize closed incidents only after the reward totals and validator
      // cursors are durably written, otherwise a second UPDATE in the same SQL
      // statement can overwrite the just-updated reward total with the older row version.
      await tx.$executeRaw(
        Prisma.sql`
          WITH finalizable_closed_incidents AS (
            SELECT
              incident.id,
              incident.opened_slot,
              incident.closed_slot,
              incident.validator_indexes
            FROM cluster_incident AS incident
            WHERE incident.status = 'closed'::"ClusterIncidentStatus"
              AND incident.rewards_finalized = FALSE
              AND incident.closed_slot IS NOT NULL
              AND incident.closed_slot <= ${params.processThroughSlot}::int
          )
          UPDATE cluster_incident AS incident
          SET
            rewards_finalized = TRUE,
            rewards_finalized_at = ${finalizedAt},
            updated_at = NOW()
          FROM finalizable_closed_incidents
          WHERE incident.id = finalizable_closed_incidents.id
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(finalizable_closed_incidents.validator_indexes) AS incident_validator(validator_index)
              LEFT JOIN validators_snapshot_stats
                ON validators_snapshot_stats.validator_index = incident_validator.validator_index
              WHERE COALESCE(
                validators_snapshot_stats.missed_rewards_processed_through_slot,
                finalizable_closed_incidents.opened_slot - 1
              ) < finalizable_closed_incidents.closed_slot
            )
        `,
      );
    });
  }
}
