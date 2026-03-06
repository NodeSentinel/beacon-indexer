import { PrismaClient } from '@beacon-indexer/db';

/**
 * SnapshotStorage - Database persistence layer for validator snapshot operations.
 *
 * Handles all database operations for the validators_snapshot_stats table.
 * All business logic happens in the controller layer.
 */
export class SnapshotStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Update attestation stats and inactivity status for all validators in clusters.
   * Uses INSERT ... ON CONFLICT to avoid wiping performance columns.
   *
   * A validator is considered "missed" if:
   *   - attestation_delay IS NULL, OR
   *   - attestation_delay > maxAttestationDelay
   *
   * A validator is "inactive" if the last N attestations (inactiveMissedCount)
   * within the queryable range were ALL missed.
   *
   * IMPORTANT: Only slots up to maxSlotToQuery can be evaluated.
   * maxSlotToQuery = currentProcessedSlot - delaySlotsToHead - missedAttestationsForInactivity
   * This ensures we don't mark validators as inactive for slots that haven't been
   * fully processed yet (accounting for attestation delay windows).
   */
  async updateAttestationsAndStatus(params: {
    minSlotHour: number;
    maxSlotToQuery: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
    inactivityCheckStartSlot: number;
  }): Promise<void> {
    const {
      minSlotHour,
      maxSlotToQuery,
      maxAttestationDelay,
      inactiveMissedCount,
      inactivityCheckStartSlot,
    } = params;

    await this.prisma.$executeRaw`
      WITH
        user_validators AS (
          SELECT DISTINCT cv.validator_index
          FROM cluster_validator cv
          JOIN validator v ON v.id = cv.validator_index
          WHERE v.status IN (2, 3)
        ),

        attestations AS (
          SELECT
            c.validator_index,
            c.slot,
            (c.attestation_delay IS NULL
              OR c.attestation_delay > ${maxAttestationDelay}::int
            )::int AS is_missed
          FROM user_validators uvs
          JOIN committee c
            ON c.validator_index = uvs.validator_index
          WHERE c.slot BETWEEN ${minSlotHour}::int AND ${maxSlotToQuery}::int
        ),

        -- Attestations for inactivity check: only from the status range
        status_attestations AS (
          SELECT
            a.validator_index,
            a.slot,
            a.is_missed,
            ROW_NUMBER() OVER (
              PARTITION BY a.validator_index
              ORDER BY a.slot DESC
            ) AS rn
          FROM attestations a
          WHERE a.slot >= ${inactivityCheckStartSlot}::int
        ),

        -- A validator is inactive if they missed ALL of the last N attestations
        inactivity AS (
          SELECT
            sa.validator_index,
            CASE
              WHEN SUM(
                CASE WHEN sa.rn <= ${inactiveMissedCount}::int THEN sa.is_missed ELSE 0 END
              ) = ${inactiveMissedCount}::int
              THEN true
              ELSE false
            END AS is_inactive,
            -- Count consecutive missed from most recent
            (
              SELECT COUNT(*)
              FROM status_attestations sa2
              WHERE sa2.validator_index = sa.validator_index
                AND sa2.is_missed = 1
                AND sa2.rn <= (
                  SELECT COALESCE(MIN(sa3.rn) - 1, ${inactiveMissedCount}::int)
                  FROM status_attestations sa3
                  WHERE sa3.validator_index = sa.validator_index
                    AND sa3.is_missed = 0
                )
            ) AS consecutive_missed
          FROM status_attestations sa
          GROUP BY sa.validator_index
        ),

        hourly AS (
          SELECT
            validator_index,
            COUNT(*)::int       AS attestations_total,
            SUM(is_missed)::int AS attestations_missed
          FROM attestations
          GROUP BY validator_index
        ),

        snapshot_data AS (
          SELECT
            h.validator_index,
            CASE WHEN COALESCE(i.is_inactive, false) THEN 'inactive' ELSE 'active' END AS status,
            COALESCE(i.is_inactive, false) AS is_inactive,
            COALESCE(i.consecutive_missed, 0)::int AS consecutive_missed_attestations,
            h.attestations_total,
            h.attestations_missed,
            v.status AS beacon_status,
            v.balance,
            COALESCE(v.effective_balance, 0) AS effective_balance
          FROM hourly h
          LEFT JOIN inactivity i USING (validator_index)
          JOIN validator v ON v.id = h.validator_index
        )

      INSERT INTO validators_snapshot_stats (
        validator_index, status, is_inactive, consecutive_missed_attestations,
        attestations_total, attestations_missed, beacon_status,
        balance, effective_balance, updated_at
      )
      SELECT
        validator_index, status, is_inactive, consecutive_missed_attestations,
        attestations_total, attestations_missed, beacon_status,
        balance, effective_balance, NOW()
      FROM snapshot_data
      ON CONFLICT (validator_index) DO UPDATE SET
        status = EXCLUDED.status,
        is_inactive = EXCLUDED.is_inactive,
        consecutive_missed_attestations = EXCLUDED.consecutive_missed_attestations,
        attestations_total = EXCLUDED.attestations_total,
        attestations_missed = EXCLUDED.attestations_missed,
        beacon_status = EXCLUDED.beacon_status,
        balance = EXCLUDED.balance,
        effective_balance = EXCLUDED.effective_balance,
        updated_at = EXCLUDED.updated_at
    `;
  }

  /**
   * Update balance fields from the validator table.
   */
  async updateBalances(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE validators_snapshot_stats vss
      SET
        balance = v.balance,
        effective_balance = COALESCE(v.effective_balance, 0),
        beacon_status = v.status,
        updated_at = NOW()
      FROM validator v
      WHERE vss.validator_index = v.id
    `;
  }

  /**
   * Update 1h performance metrics from raw committee and epoch_rewards tables.
   */
  async updatePerformance1h(params: {
    minSlot: number;
    maxSlot: number;
    minEpoch: number;
    maxEpoch: number;
    maxAttestationDelay: number;
  }): Promise<void> {
    const { minSlot, maxSlot, minEpoch, maxEpoch, maxAttestationDelay } = params;

    await this.prisma.$executeRaw`
      WITH
        user_validators AS (
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
        ),
        att AS (
          SELECT
            c.validator_index,
            COUNT(*) AS total,
            SUM(CASE WHEN c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int THEN 1 ELSE 0 END) AS missed
          FROM committee c
          JOIN user_validators uv ON c.validator_index = uv.validator_index
          WHERE c.slot BETWEEN ${minSlot}::int AND ${maxSlot}::int
          GROUP BY c.validator_index
        ),
        rew AS (
          SELECT
            er.validator_index,
            SUM(er.head + er.target + er.source) AS consensus_reward,
            SUM(er.missed_head + er.missed_target + er.missed_source) AS missed_reward
          FROM epoch_rewards er
          JOIN user_validators uv ON er.validator_index = uv.validator_index
          WHERE er.epoch BETWEEN ${minEpoch}::int AND ${maxEpoch}::int
          GROUP BY er.validator_index
        ),
        exec_rew AS (
          SELECT
            s.proposer_index AS validator_index,
            SUM(COALESCE(s.execution_reward, 0)) AS execution_reward
          FROM slot s
          JOIN user_validators uv ON s.proposer_index = uv.validator_index
          WHERE s.slot BETWEEN ${minSlot}::int AND ${maxSlot}::int
            AND s.proposer_index IS NOT NULL
          GROUP BY s.proposer_index
        ),
        perf AS (
          SELECT
            a.validator_index,
            CASE WHEN a.total > 0
              THEN ((a.total - a.missed)::numeric / a.total)::numeric(5,4)
              ELSE NULL
            END AS performance_1h,
            r.consensus_reward,
            r.missed_reward,
            e.execution_reward,
            CASE WHEN v.balance > 0 AND r.consensus_reward IS NOT NULL
              THEN (r.consensus_reward::numeric / v.balance * 8766)::numeric(5,2)
              ELSE NULL
            END AS apy_1h
          FROM att a
          LEFT JOIN rew r ON a.validator_index = r.validator_index
          LEFT JOIN exec_rew e ON a.validator_index = e.validator_index
          JOIN validator v ON v.id = a.validator_index
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_1h = p.performance_1h,
        apy_1h = p.apy_1h,
        consensus_reward_1h = p.consensus_reward,
        missed_reward_1h = p.missed_reward,
        execution_reward_1h = p.execution_reward,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update 1d performance metrics from ValidatorHourlyArchive (last 24h).
   */
  async updatePerformance1d(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await this.prisma.$executeRaw`
      WITH
        archive_data AS (
          SELECT
            vha.validator_index,
            SUM(vha.attestation_count) AS att_count,
            SUM(COALESCE(vha.missed_attestation_count, 0)) AS missed_att_count,
            SUM(vha.cl_reward_total) AS consensus_reward,
            SUM(vha.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vha.exec_reward_total, 0)) AS execution_reward
          FROM validator_hourly_archive vha
          WHERE vha.timestamp >= ${cutoff}
          GROUP BY vha.validator_index
        ),
        perf AS (
          SELECT
            ad.validator_index,
            CASE WHEN ad.att_count > 0
              THEN ((ad.att_count - ad.missed_att_count)::numeric / ad.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_1d,
            ad.consensus_reward,
            ad.missed_reward,
            ad.execution_reward,
            CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL
              THEN (ad.consensus_reward::numeric / v.balance * 365.25)::numeric(5,2)
              ELSE NULL
            END AS apy_1d
          FROM archive_data ad
          JOIN validator v ON v.id = ad.validator_index
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_1d = p.performance_1d,
        apy_1d = p.apy_1d,
        consensus_reward_1d = p.consensus_reward,
        missed_reward_1d = p.missed_reward,
        execution_reward_1d = p.execution_reward,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update 1w performance metrics from ValidatorDailyArchive (last 7 days).
   */
  async updatePerformance1w(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$executeRaw`
      WITH
        archive_data AS (
          SELECT
            vda.validator_index,
            SUM(vda.attestation_count) AS att_count,
            SUM(COALESCE(vda.missed_attestation_count, 0)) AS missed_att_count,
            SUM(vda.cl_reward_total) AS consensus_reward,
            SUM(vda.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vda.exec_reward_total, 0)) AS execution_reward
          FROM validator_daily_archive vda
          WHERE vda.timestamp >= ${cutoff}
          GROUP BY vda.validator_index
        ),
        perf AS (
          SELECT
            ad.validator_index,
            CASE WHEN ad.att_count > 0
              THEN ((ad.att_count - ad.missed_att_count)::numeric / ad.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_1w,
            ad.consensus_reward,
            ad.missed_reward,
            ad.execution_reward,
            CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL
              THEN (ad.consensus_reward::numeric / v.balance * 52.18)::numeric(5,2)
              ELSE NULL
            END AS apy_1w
          FROM archive_data ad
          JOIN validator v ON v.id = ad.validator_index
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_1w = p.performance_1w,
        apy_w = p.apy_1w,
        consensus_reward_1w = p.consensus_reward,
        missed_reward_1w = p.missed_reward,
        execution_reward_1w = p.execution_reward,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update 1m performance metrics from ValidatorDailyArchive (last 30 days).
   */
  async updatePerformance1m(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await this.prisma.$executeRaw`
      WITH
        archive_data AS (
          SELECT
            vda.validator_index,
            SUM(vda.attestation_count) AS att_count,
            SUM(COALESCE(vda.missed_attestation_count, 0)) AS missed_att_count,
            SUM(vda.cl_reward_total) AS consensus_reward,
            SUM(vda.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vda.exec_reward_total, 0)) AS execution_reward
          FROM validator_daily_archive vda
          WHERE vda.timestamp >= ${cutoff}
          GROUP BY vda.validator_index
        ),
        perf AS (
          SELECT
            ad.validator_index,
            CASE WHEN ad.att_count > 0
              THEN ((ad.att_count - ad.missed_att_count)::numeric / ad.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_1m,
            ad.consensus_reward,
            ad.missed_reward,
            ad.execution_reward,
            CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL
              THEN (ad.consensus_reward::numeric / v.balance * 12)::numeric(5,2)
              ELSE NULL
            END AS apy_1m
          FROM archive_data ad
          JOIN validator v ON v.id = ad.validator_index
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_1m = p.performance_1m,
        apy_1m = p.apy_1m,
        consensus_reward_1m = p.consensus_reward,
        missed_reward_1m = p.missed_reward,
        execution_reward_1m = p.execution_reward,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }
}
