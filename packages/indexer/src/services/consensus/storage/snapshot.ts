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
   * Update attestation stats and inactivity status for all validators that have snapshot rows.
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
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
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

      UPDATE validators_snapshot_stats vss
      SET
        status = sd.status,
        is_inactive = sd.is_inactive,
        consecutive_missed_attestations = sd.consecutive_missed_attestations,
        attestations_total = sd.attestations_total,
        attestations_missed = sd.attestations_missed,
        beacon_status = sd.beacon_status,
        balance = sd.balance,
        effective_balance = sd.effective_balance,
        updated_at = NOW()
      FROM snapshot_data sd
      WHERE vss.validator_index = sd.validator_index
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
   * Update h performance metrics from raw committee and epoch_rewards tables.
   */
  async updatePerformanceH(params: {
    minSlot: number;
    maxSlot: number;
    minEpoch: number;
    maxEpoch: number;
    maxAttestationDelay: number;
    validatorIndexes?: number[];
  }): Promise<void> {
    const { minSlot, maxSlot, minEpoch, maxEpoch, maxAttestationDelay, validatorIndexes } = params;

    await this.prisma.$executeRaw`
      WITH
        user_validators AS (
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
          WHERE (${validatorIndexes ?? null}::int[] IS NULL
            OR vss.validator_index = ANY(${validatorIndexes ?? null}::int[]))
        ),
        att AS (
          SELECT
            c.validator_index,
            COUNT(*) AS total,
            SUM(CASE WHEN c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int THEN 1 ELSE 0 END) AS missed,
            ARRAY_AGG(c.slot) FILTER (WHERE c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int) AS missed_slots
          FROM committee c
          JOIN user_validators uv ON c.validator_index = uv.validator_index
          WHERE c.slot BETWEEN ${minSlot}::int AND ${maxSlot}::int
          GROUP BY c.validator_index
        ),
        rew AS (
          SELECT
            er.validator_index,
            SUM(er.head + er.target + er.source + er.inactivity) AS epoch_reward,
            SUM(er.missed_head + er.missed_target + er.missed_source + er.missed_inactivity) AS missed_reward
          FROM epoch_rewards er
          JOIN user_validators uv ON er.validator_index = uv.validator_index
          WHERE er.epoch BETWEEN ${minEpoch}::int AND ${maxEpoch}::int
          GROUP BY er.validator_index
        ),
        sync_rew AS (
          SELECT
            scr.validator_index,
            SUM(scr.sync_committee_reward) AS sync_reward
          FROM sync_committee_rewards scr
          JOIN user_validators uv ON scr.validator_index = uv.validator_index
          WHERE scr.slot BETWEEN ${minSlot}::int AND ${maxSlot}::int
          GROUP BY scr.validator_index
        ),
        block_rew AS (
          SELECT
            s.proposer_index AS validator_index,
            SUM(s.consensus_reward) AS block_reward
          FROM slot s
          JOIN user_validators uv ON s.proposer_index = uv.validator_index
          WHERE s.slot BETWEEN ${minSlot}::int AND ${maxSlot}::int
            AND s.proposer_index IS NOT NULL
            AND s.consensus_reward IS NOT NULL
            AND s.consensus_reward > 0
          GROUP BY s.proposer_index
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
            END AS performance_h,
            COALESCE(a.missed_slots, '{}') AS missed_attestation_slots_h,
            COALESCE(a.missed, 0)::int AS missed_attestation_count_h,
            COALESCE(r.epoch_reward, 0) + COALESCE(sr.sync_reward, 0) + COALESCE(br.block_reward, 0) AS consensus_reward,
            r.missed_reward,
            e.execution_reward,
            CASE WHEN v.balance > 0 AND (r.epoch_reward IS NOT NULL OR sr.sync_reward IS NOT NULL OR br.block_reward IS NOT NULL)
              THEN ((COALESCE(r.epoch_reward, 0) + COALESCE(sr.sync_reward, 0) + COALESCE(br.block_reward, 0))::numeric / v.balance * 8766 * 100)::numeric(5,2)
              ELSE NULL
            END AS apy_h
          FROM att a
          LEFT JOIN rew r ON a.validator_index = r.validator_index
          LEFT JOIN sync_rew sr ON a.validator_index = sr.validator_index
          LEFT JOIN block_rew br ON a.validator_index = br.validator_index
          LEFT JOIN exec_rew e ON a.validator_index = e.validator_index
          JOIN validator v ON v.id = a.validator_index
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_h = p.performance_h,
        missed_attestation_slots_h = p.missed_attestation_slots_h,
        missed_attestation_count_h = p.missed_attestation_count_h,
        apy_h = p.apy_h,
        consensus_reward_h = p.consensus_reward,
        missed_reward_h = p.missed_reward,
        execution_reward_h = p.execution_reward,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update d performance metrics combining hourly archives + live data.
   *
   * Reads archive.lastHour to determine the boundary between archived and live data,
   * then combines both sources in a single atomic query:
   * - Archived hours from validator_hourly_archive (up to lastHour)
   * - Live hours from committee/epoch_rewards/sync_committee_rewards/slot (complete hours only)
   *
   * Chain params are needed to convert timestamps to slot/epoch ranges in SQL.
   */
  async updatePerformanceD(params: {
    genesisTimeSec: number;
    secPerSlot: number;
    slotsPerEpoch: number;
    maxAttestationDelay: number;
    validatorIndexes?: number[];
  }): Promise<void> {
    const { genesisTimeSec, secPerSlot, slotsPerEpoch, maxAttestationDelay, validatorIndexes } =
      params;

    await this.prisma.$executeRaw`
      WITH
        -- Chain configuration for timestamp → slot/epoch conversion
        chain AS (
          SELECT
            ${genesisTimeSec}::bigint AS genesis_sec,
            ${secPerSlot}::int AS sec_per_slot,
            ${slotsPerEpoch}::int AS slots_per_epoch
        ),

        -- Read last archived hour from archive control table
        archive_info AS (
          SELECT last_hour FROM archive WHERE id = 1
        ),

        -- Time boundaries:
        -- - archived data covers up to last_hour (inclusive)
        -- - live data covers from last_hour+1h to the start of current (incomplete) hour
        time_bounds AS (
          SELECT
            ai.last_hour,
            ai.last_hour + interval '1 hour' AS live_start,
            date_trunc('hour', NOW() AT TIME ZONE 'UTC') AS live_end
          FROM archive_info ai
        ),

        -- Convert time boundaries to slot/epoch ranges
        slot_bounds AS (
          SELECT
            FLOOR((EXTRACT(EPOCH FROM tb.live_start) - c.genesis_sec) / c.sec_per_slot)::int AS live_start_slot,
            FLOOR((EXTRACT(EPOCH FROM tb.live_end) - c.genesis_sec) / c.sec_per_slot)::int - 1 AS live_end_slot,
            FLOOR((EXTRACT(EPOCH FROM tb.live_start) - c.genesis_sec) / c.sec_per_slot / c.slots_per_epoch)::int AS live_start_epoch,
            FLOOR((EXTRACT(EPOCH FROM tb.live_end) - c.genesis_sec) / c.sec_per_slot / c.slots_per_epoch)::int - 1 AS live_end_epoch,
            GREATEST(0, EXTRACT(EPOCH FROM tb.live_end - tb.live_start)::int / 3600) AS live_hours,
            tb.last_hour
          FROM time_bounds tb
          CROSS JOIN chain c
        ),

        target_validators AS (
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
          WHERE (${validatorIndexes ?? null}::int[] IS NULL
            OR vss.validator_index = ANY(${validatorIndexes ?? null}::int[]))
        ),

        -- ARCHIVED DATA: get (24 - live_hours) most recent archived hours
        ranked_archive_hours AS (
          SELECT timestamp,
            ROW_NUMBER() OVER (ORDER BY timestamp DESC) AS rn
          FROM (
            SELECT DISTINCT timestamp
            FROM validator_hourly_archive
            WHERE timestamp <= (SELECT last_hour FROM slot_bounds)
          ) sub
        ),
        filtered_archive_hours AS (
          SELECT timestamp FROM ranked_archive_hours
          WHERE rn <= GREATEST(0, 24 - (SELECT live_hours FROM slot_bounds))
        ),
        archive_hour_count AS (
          SELECT COUNT(*)::int AS n FROM filtered_archive_hours
        ),

        archive_agg AS (
          SELECT
            vha.validator_index,
            SUM(vha.cl_reward_total) + SUM(COALESCE(vha.sync_reward_total, 0)) + SUM(COALESCE(vha.block_reward_total, 0)) AS consensus_reward,
            SUM(vha.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vha.exec_reward_total, 0)) AS execution_reward,
            SUM(vha.attestation_count + COALESCE(vha.missed_attestation_count, 0))::bigint AS att_count,
            SUM(COALESCE(vha.missed_attestation_count, 0))::bigint AS missed_att_count,
            (SUM(vha.avg_attestation_delay * vha.attestation_count) / NULLIF(SUM(CASE WHEN vha.avg_attestation_delay IS NOT NULL THEN vha.attestation_count ELSE 0 END), 0))::real AS avg_att_delay,
            (SUM(vha.attestation_efficiency * vha.attestation_count) / NULLIF(SUM(CASE WHEN vha.attestation_efficiency IS NOT NULL THEN vha.attestation_count ELSE 0 END), 0))::real AS att_efficiency
          FROM validator_hourly_archive vha
          JOIN target_validators tv ON vha.validator_index = tv.validator_index
          WHERE vha.timestamp IN (SELECT timestamp FROM filtered_archive_hours)
          GROUP BY vha.validator_index
        ),

        -- LIVE DATA: complete hours between lastHour+1h and current hour start
        live_att AS (
          SELECT
            c.validator_index,
            COUNT(*)::bigint AS att_count,
            SUM(CASE WHEN c.attestation_delay IS NULL OR c.attestation_delay > ${maxAttestationDelay}::int THEN 1 ELSE 0 END)::bigint AS missed_att_count,
            AVG(c.attestation_delay) FILTER (WHERE c.attestation_delay IS NOT NULL)::real AS avg_att_delay,
            (SUM(CASE
              WHEN c.attestation_delay IS NULL THEN 0.0
              WHEN c.attestation_delay <= 1 THEN 1.0
              WHEN c.attestation_delay = 2 THEN 0.75
              WHEN c.attestation_delay = 3 THEN 0.50
              WHEN c.attestation_delay <= 5 THEN 0.25
              ELSE 0.0
            END) / NULLIF(COUNT(*), 0))::real AS att_efficiency
          FROM committee c
          JOIN target_validators tv ON c.validator_index = tv.validator_index
          CROSS JOIN slot_bounds sb
          WHERE sb.live_hours > 0
            AND c.slot BETWEEN sb.live_start_slot AND sb.live_end_slot
          GROUP BY c.validator_index
        ),

        live_rew AS (
          SELECT
            er.validator_index,
            SUM(er.head + er.target + er.source + er.inactivity) AS epoch_reward,
            SUM(er.missed_head + er.missed_target + er.missed_source + er.missed_inactivity) AS missed_reward
          FROM epoch_rewards er
          JOIN target_validators tv ON er.validator_index = tv.validator_index
          CROSS JOIN slot_bounds sb
          WHERE sb.live_hours > 0
            AND er.epoch BETWEEN sb.live_start_epoch AND sb.live_end_epoch
          GROUP BY er.validator_index
        ),

        live_sync AS (
          SELECT
            scr.validator_index,
            SUM(scr.sync_committee_reward) AS sync_reward
          FROM sync_committee_rewards scr
          JOIN target_validators tv ON scr.validator_index = tv.validator_index
          CROSS JOIN slot_bounds sb
          WHERE sb.live_hours > 0
            AND scr.slot BETWEEN sb.live_start_slot AND sb.live_end_slot
          GROUP BY scr.validator_index
        ),

        live_block AS (
          SELECT
            s.proposer_index AS validator_index,
            SUM(s.consensus_reward) AS block_reward
          FROM slot s
          JOIN target_validators tv ON s.proposer_index = tv.validator_index
          CROSS JOIN slot_bounds sb
          WHERE sb.live_hours > 0
            AND s.slot BETWEEN sb.live_start_slot AND sb.live_end_slot
            AND s.proposer_index IS NOT NULL
            AND s.consensus_reward IS NOT NULL AND s.consensus_reward > 0
          GROUP BY s.proposer_index
        ),

        live_exec AS (
          SELECT
            s.proposer_index AS validator_index,
            SUM(COALESCE(s.execution_reward, 0)) AS execution_reward
          FROM slot s
          JOIN target_validators tv ON s.proposer_index = tv.validator_index
          CROSS JOIN slot_bounds sb
          WHERE sb.live_hours > 0
            AND s.slot BETWEEN sb.live_start_slot AND sb.live_end_slot
            AND s.proposer_index IS NOT NULL
          GROUP BY s.proposer_index
        ),

        live_agg AS (
          SELECT
            COALESCE(la.validator_index, lr.validator_index) AS validator_index,
            COALESCE(lr.epoch_reward, 0) + COALESCE(ls.sync_reward, 0) + COALESCE(lb.block_reward, 0) AS consensus_reward,
            COALESCE(lr.missed_reward, 0) AS missed_reward,
            COALESCE(le.execution_reward, 0) AS execution_reward,
            COALESCE(la.att_count, 0)::bigint AS att_count,
            COALESCE(la.missed_att_count, 0)::bigint AS missed_att_count,
            la.avg_att_delay,
            la.att_efficiency
          FROM live_att la
          FULL OUTER JOIN live_rew lr ON la.validator_index = lr.validator_index
          LEFT JOIN live_sync ls ON COALESCE(la.validator_index, lr.validator_index) = ls.validator_index
          LEFT JOIN live_block lb ON COALESCE(la.validator_index, lr.validator_index) = lb.validator_index
          LEFT JOIN live_exec le ON COALESCE(la.validator_index, lr.validator_index) = le.validator_index
        ),

        -- COMBINE archive + live
        combined AS (
          SELECT
            validator_index,
            SUM(consensus_reward) AS consensus_reward,
            SUM(missed_reward) AS missed_reward,
            SUM(execution_reward) AS execution_reward,
            SUM(att_count) AS att_count,
            SUM(missed_att_count) AS missed_att_count,
            (SUM(avg_att_delay * att_count) / NULLIF(SUM(CASE WHEN avg_att_delay IS NOT NULL THEN att_count ELSE 0 END), 0))::real AS avg_att_delay,
            (SUM(att_efficiency * att_count) / NULLIF(SUM(CASE WHEN att_efficiency IS NOT NULL THEN att_count ELSE 0 END), 0))::real AS att_efficiency
          FROM (
            SELECT * FROM archive_agg
            UNION ALL
            SELECT * FROM live_agg
          ) all_data
          GROUP BY validator_index
        ),

        total_hours AS (
          SELECT (SELECT n FROM archive_hour_count) + (SELECT live_hours FROM slot_bounds)::int AS n
        ),

        perf AS (
          SELECT
            c.validator_index,
            CASE WHEN c.att_count > 0
              THEN ((c.att_count - c.missed_att_count)::numeric / c.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_d,
            c.consensus_reward,
            c.missed_reward,
            c.execution_reward,
            CASE WHEN v.balance > 0 AND c.consensus_reward IS NOT NULL AND th.n > 0
              THEN (c.consensus_reward::numeric / v.balance * (8766.0 / th.n) * 100)::numeric(5,2)
              ELSE NULL
            END AS apy_d,
            c.avg_att_delay,
            c.att_efficiency
          FROM combined c
          JOIN validator v ON v.id = c.validator_index
          CROSS JOIN total_hours th
        )

      UPDATE validators_snapshot_stats vss
      SET
        performance_d = p.performance_d,
        apy_d = p.apy_d,
        consensus_reward_d = p.consensus_reward,
        missed_reward_d = p.missed_reward,
        execution_reward_d = p.execution_reward,
        avg_attestation_delay_d = p.avg_att_delay,
        attestation_efficiency_d = p.att_efficiency,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update w performance metrics from ValidatorDailyArchive (last 7 days).
   *
   * Uses the 7 most recent archived days to ensure a full week of data.
   * APY is adjusted by the actual number of days covered (365.25 / days_covered * 100).
   */
  async updatePerformanceW(params?: { validatorIndexes?: number[] }): Promise<void> {
    const validatorIndexes = params?.validatorIndexes;

    await this.prisma.$executeRaw`
      WITH
        target_validators AS (
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
          WHERE (${validatorIndexes ?? null}::int[] IS NULL
            OR vss.validator_index = ANY(${validatorIndexes ?? null}::int[]))
        ),
        recent_days AS (
          SELECT DISTINCT timestamp
          FROM validator_daily_archive
          ORDER BY timestamp DESC
          LIMIT 7
        ),
        day_count AS (
          SELECT COUNT(*)::int AS n FROM recent_days
        ),
        archive_data AS (
          SELECT
            vda.validator_index,
            SUM(vda.attestation_count + COALESCE(vda.missed_attestation_count, 0)) AS att_count,
            SUM(COALESCE(vda.missed_attestation_count, 0)) AS missed_att_count,
            SUM(vda.cl_reward_total) + SUM(COALESCE(vda.sync_reward_total, 0)) + SUM(COALESCE(vda.block_reward_total, 0)) AS consensus_reward,
            SUM(vda.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vda.exec_reward_total, 0)) AS execution_reward,
            (SUM(vda.avg_attestation_delay * vda.attestation_count) / NULLIF(SUM(CASE WHEN vda.avg_attestation_delay IS NOT NULL THEN vda.attestation_count ELSE 0 END), 0))::real AS avg_att_delay,
            (SUM(vda.attestation_efficiency * vda.attestation_count) / NULLIF(SUM(CASE WHEN vda.attestation_efficiency IS NOT NULL THEN vda.attestation_count ELSE 0 END), 0))::real AS att_efficiency
          FROM validator_daily_archive vda
          JOIN target_validators tv ON vda.validator_index = tv.validator_index
          WHERE vda.timestamp IN (SELECT timestamp FROM recent_days)
          GROUP BY vda.validator_index
        ),
        perf AS (
          SELECT
            ad.validator_index,
            CASE WHEN ad.att_count > 0
              THEN ((ad.att_count - ad.missed_att_count)::numeric / ad.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_w,
            ad.consensus_reward,
            ad.missed_reward,
            ad.execution_reward,
            CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL AND dc.n > 0
              THEN (ad.consensus_reward::numeric / v.balance * (365.25 / dc.n) * 100)::numeric(5,2)
              ELSE NULL
            END AS apy_w,
            ad.avg_att_delay,
            ad.att_efficiency
          FROM archive_data ad
          JOIN validator v ON v.id = ad.validator_index
          CROSS JOIN day_count dc
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_w = p.performance_w,
        apy_w = p.apy_w,
        consensus_reward_w = p.consensus_reward,
        missed_reward_w = p.missed_reward,
        execution_reward_w = p.execution_reward,
        avg_attestation_delay_w = p.avg_att_delay,
        attestation_efficiency_w = p.att_efficiency,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Update m performance metrics from ValidatorDailyArchive (last 30 days).
   *
   * Uses the 30 most recent archived days to ensure a full month of data.
   * APY is adjusted by the actual number of days covered (365.25 / days_covered * 100).
   */
  async updatePerformanceM(params?: { validatorIndexes?: number[] }): Promise<void> {
    const validatorIndexes = params?.validatorIndexes;

    await this.prisma.$executeRaw`
      WITH
        target_validators AS (
          SELECT DISTINCT vss.validator_index
          FROM validators_snapshot_stats vss
          WHERE (${validatorIndexes ?? null}::int[] IS NULL
            OR vss.validator_index = ANY(${validatorIndexes ?? null}::int[]))
        ),
        recent_days AS (
          SELECT DISTINCT timestamp
          FROM validator_daily_archive
          ORDER BY timestamp DESC
          LIMIT 30
        ),
        day_count AS (
          SELECT COUNT(*)::int AS n FROM recent_days
        ),
        archive_data AS (
          SELECT
            vda.validator_index,
            SUM(vda.attestation_count + COALESCE(vda.missed_attestation_count, 0)) AS att_count,
            SUM(COALESCE(vda.missed_attestation_count, 0)) AS missed_att_count,
            SUM(vda.cl_reward_total) + SUM(COALESCE(vda.sync_reward_total, 0)) + SUM(COALESCE(vda.block_reward_total, 0)) AS consensus_reward,
            SUM(vda.cl_missed_reward_total) AS missed_reward,
            SUM(COALESCE(vda.exec_reward_total, 0)) AS execution_reward,
            (SUM(vda.avg_attestation_delay * vda.attestation_count) / NULLIF(SUM(CASE WHEN vda.avg_attestation_delay IS NOT NULL THEN vda.attestation_count ELSE 0 END), 0))::real AS avg_att_delay,
            (SUM(vda.attestation_efficiency * vda.attestation_count) / NULLIF(SUM(CASE WHEN vda.attestation_efficiency IS NOT NULL THEN vda.attestation_count ELSE 0 END), 0))::real AS att_efficiency
          FROM validator_daily_archive vda
          JOIN target_validators tv ON vda.validator_index = tv.validator_index
          WHERE vda.timestamp IN (SELECT timestamp FROM recent_days)
          GROUP BY vda.validator_index
        ),
        perf AS (
          SELECT
            ad.validator_index,
            CASE WHEN ad.att_count > 0
              THEN ((ad.att_count - ad.missed_att_count)::numeric / ad.att_count)::numeric(5,4)
              ELSE NULL
            END AS performance_m,
            ad.consensus_reward,
            ad.missed_reward,
            ad.execution_reward,
            CASE WHEN v.balance > 0 AND ad.consensus_reward IS NOT NULL AND dc.n > 0
              THEN (ad.consensus_reward::numeric / v.balance * (365.25 / dc.n) * 100)::numeric(5,2)
              ELSE NULL
            END AS apy_m,
            ad.avg_att_delay,
            ad.att_efficiency
          FROM archive_data ad
          JOIN validator v ON v.id = ad.validator_index
          CROSS JOIN day_count dc
        )
      UPDATE validators_snapshot_stats vss
      SET
        performance_m = p.performance_m,
        apy_m = p.apy_m,
        consensus_reward_m = p.consensus_reward,
        missed_reward_m = p.missed_reward,
        execution_reward_m = p.execution_reward,
        avg_attestation_delay_m = p.avg_att_delay,
        attestation_efficiency_m = p.att_efficiency,
        updated_at = NOW()
      FROM perf p
      WHERE vss.validator_index = p.validator_index
    `;
  }

  /**
   * Find validators that are in clusters but don't have a snapshot row yet.
   */
  async findNewValidators(): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<Array<{ validator_index: number }>>`
      SELECT DISTINCT cv.validator_index
      FROM cluster_validator cv
      JOIN validator v ON v.id = cv.validator_index
      WHERE v.status IN (2, 3)
        AND NOT EXISTS (
          SELECT 1 FROM validators_snapshot_stats vss
          WHERE vss.validator_index = cv.validator_index
        )
    `;
    return rows.map((r) => r.validator_index);
  }

  /**
   * Insert base snapshot rows for new validators.
   * Populates balance/status from the validator table. All performance fields start as NULL.
   */
  async insertNewValidatorSnapshots(validatorIndexes: number[]): Promise<void> {
    if (validatorIndexes.length === 0) return;

    await this.prisma.$executeRaw`
      INSERT INTO validators_snapshot_stats (
        validator_index, status, is_inactive, consecutive_missed_attestations,
        attestations_total, attestations_missed, beacon_status,
        balance, effective_balance, updated_at
      )
      SELECT
        v.id,
        'active',
        false,
        0,
        0,
        0,
        v.status,
        v.balance,
        COALESCE(v.effective_balance, 0),
        NOW()
      FROM validator v
      WHERE v.id = ANY(${validatorIndexes}::int[])
      ON CONFLICT (validator_index) DO NOTHING
    `;
  }
}
