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

    // Keep the interval reconciliation, incident aggregate refresh, and
    // closed-incident finalization inside one transaction so a partial failure
    // cannot advance interval cursors ahead of the persisted totals.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          WITH candidate_intervals AS (
            -- One row in cluster_incident_validator is one inactivity interval
            -- inside one incident. Rewards are reconciled interval-by-interval.
            SELECT
              cluster_incident_validator.id AS interval_id,
              incident.id AS incident_id,
              cluster_incident_validator.validator_index,
              cluster_incident_validator.inactive_from_slot,
              cluster_incident_validator.inactive_to_slot,
              cluster_incident_validator.rewards_processed_through_slot
            FROM cluster_incident_validator
            JOIN cluster_incident AS incident
              ON incident.id = cluster_incident_validator.incident_id
            WHERE incident.status = 'open'::"ClusterIncidentStatus"
              OR (
                incident.status = 'closed'::"ClusterIncidentStatus"
                AND incident.rewards_finalized = FALSE
              )
          ),
          interval_ranges AS (
            -- Each interval advances only across its own slot window.
            SELECT
              candidate_intervals.interval_id,
              candidate_intervals.validator_index,
              candidate_intervals.incident_id,
              GREATEST(
                candidate_intervals.inactive_from_slot,
                COALESCE(candidate_intervals.rewards_processed_through_slot + 1, candidate_intervals.inactive_from_slot)
              ) AS lower_bound,
              LEAST(
                COALESCE(candidate_intervals.inactive_to_slot, ${params.processThroughSlot}::int),
                ${params.processThroughSlot}::int
              ) AS upper_bound,
              GREATEST(
                candidate_intervals.inactive_from_slot,
                COALESCE(candidate_intervals.rewards_processed_through_slot + 1, candidate_intervals.inactive_from_slot)
              ) / ${slotsPerEpoch}::int AS start_epoch,
              LEAST(
                COALESCE(candidate_intervals.inactive_to_slot, ${params.processThroughSlot}::int),
                ${params.processThroughSlot}::int
              ) / ${slotsPerEpoch}::int AS end_epoch
            FROM candidate_intervals
            WHERE GREATEST(
              candidate_intervals.inactive_from_slot,
              COALESCE(candidate_intervals.rewards_processed_through_slot + 1, candidate_intervals.inactive_from_slot)
            ) <= LEAST(
              COALESCE(candidate_intervals.inactive_to_slot, ${params.processThroughSlot}::int),
              ${params.processThroughSlot}::int
            )
          ),
          attestation_sums AS (
            -- Count only the missed attestation columns because those are the
            -- rewards and penalties attributable to inactive intervals.
            SELECT
              interval_ranges.interval_id,
              COALESCE(
                SUM(
                  epoch_rewards.missed_head +
                  epoch_rewards.missed_target +
                  epoch_rewards.missed_source +
                  epoch_rewards.missed_inactivity
                ),
                0
              )::bigint AS missed_rewards
            FROM interval_ranges
            LEFT JOIN epoch_rewards
              ON epoch_rewards.validator_index = interval_ranges.validator_index
              AND epoch_rewards.epoch BETWEEN interval_ranges.start_epoch AND interval_ranges.end_epoch
            GROUP BY interval_ranges.interval_id
          ),
          sync_sums AS (
            -- Sync committee rewards are slot-granular, so clip them directly
            -- to the interval slot window and count only penalties.
            SELECT
              interval_ranges.interval_id,
              COALESCE(
                SUM(-validator_sync_rewards.sync_committee),
                0
              )::bigint AS missed_rewards
            FROM interval_ranges
            LEFT JOIN validator_sync_rewards
              ON validator_sync_rewards.validator_index = interval_ranges.validator_index
              AND validator_sync_rewards.slot BETWEEN interval_ranges.lower_bound AND interval_ranges.upper_bound
              AND validator_sync_rewards.sync_committee < 0
            GROUP BY interval_ranges.interval_id
          ),
          interval_deltas AS (
            -- Merge both reward sources back onto the interval row and advance
            -- its own cursor to the slot just processed.
            SELECT
              interval_ranges.interval_id,
              interval_ranges.upper_bound,
              COALESCE(attestation_sums.missed_rewards, 0)::bigint AS attestation_delta,
              COALESCE(sync_sums.missed_rewards, 0)::bigint AS sync_delta,
              (
                COALESCE(attestation_sums.missed_rewards, 0) +
                COALESCE(sync_sums.missed_rewards, 0)
              )::bigint AS consensus_delta
            FROM interval_ranges
            LEFT JOIN attestation_sums
              ON attestation_sums.interval_id = interval_ranges.interval_id
            LEFT JOIN sync_sums
              ON sync_sums.interval_id = interval_ranges.interval_id
          ),
          updated_intervals AS (
            UPDATE cluster_incident_validator AS cluster_incident_validator
            SET
              missed_attestation_rewards =
                cluster_incident_validator.missed_attestation_rewards + interval_deltas.attestation_delta,
              missed_sync_rewards =
                cluster_incident_validator.missed_sync_rewards + interval_deltas.sync_delta,
              missed_consensus_rewards =
                cluster_incident_validator.missed_consensus_rewards + interval_deltas.consensus_delta,
              rewards_processed_through_slot = interval_deltas.upper_bound,
              updated_at = NOW()
            FROM interval_deltas
            WHERE cluster_incident_validator.id = interval_deltas.interval_id
            RETURNING cluster_incident_validator.incident_id
          )
          SELECT 1
        `,
      );

      // Refresh incident totals from the interval rows after the interval-level
      // updates are durable so the aggregate remains a pure projection.
      await tx.$executeRaw(
        Prisma.sql`
          WITH candidate_incidents AS (
            SELECT
              incident.id
            FROM cluster_incident AS incident
            WHERE incident.status = 'open'::"ClusterIncidentStatus"
              OR (
                incident.status = 'closed'::"ClusterIncidentStatus"
                AND incident.rewards_finalized = FALSE
              )
          )
          UPDATE cluster_incident AS incident
          SET
            missed_attestation_rewards = COALESCE(incident_totals.missed_attestation_rewards, 0),
            missed_sync_rewards = COALESCE(incident_totals.missed_sync_rewards, 0),
            missed_consensus_rewards = COALESCE(incident_totals.missed_consensus_rewards, 0),
            updated_at = NOW()
          FROM (
            SELECT
              cluster_incident_validator.incident_id,
              SUM(cluster_incident_validator.missed_attestation_rewards)::bigint AS missed_attestation_rewards,
              SUM(cluster_incident_validator.missed_sync_rewards)::bigint AS missed_sync_rewards,
              SUM(cluster_incident_validator.missed_consensus_rewards)::bigint AS missed_consensus_rewards
            FROM cluster_incident_validator
            GROUP BY cluster_incident_validator.incident_id
          ) AS incident_totals
          WHERE incident.id IN (SELECT candidate_incidents.id FROM candidate_incidents)
            AND incident.id = incident_totals.incident_id
        `,
      );

      await tx.$executeRaw(
        Prisma.sql`
          WITH zero_total_incidents AS (
            SELECT candidate_incidents.id
            FROM (
              SELECT incident.id
              FROM cluster_incident AS incident
              WHERE incident.status = 'open'::"ClusterIncidentStatus"
                OR (
                  incident.status = 'closed'::"ClusterIncidentStatus"
                  AND incident.rewards_finalized = FALSE
                )
            ) AS candidate_incidents
            WHERE NOT EXISTS (
              SELECT 1
              FROM cluster_incident_validator
              WHERE cluster_incident_validator.incident_id = candidate_incidents.id
            )
          )
          UPDATE cluster_incident AS incident
          SET
            missed_attestation_rewards = 0,
            missed_sync_rewards = 0,
            missed_consensus_rewards = 0,
            updated_at = NOW()
          FROM zero_total_incidents
          WHERE incident.id = zero_total_incidents.id
        `,
      );

      await tx.$executeRaw(
        Prisma.sql`
          WITH finalizable_closed_incidents AS (
            SELECT
              incident.id
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
              FROM cluster_incident_validator
              WHERE cluster_incident_validator.incident_id = finalizable_closed_incidents.id
                AND cluster_incident_validator.inactive_to_slot IS NOT NULL
                AND COALESCE(
                  cluster_incident_validator.rewards_processed_through_slot,
                  cluster_incident_validator.inactive_from_slot - 1
                ) < cluster_incident_validator.inactive_to_slot
            )
        `,
      );
    });
  }
}
