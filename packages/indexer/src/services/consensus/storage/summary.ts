import { PrismaClient } from '@beacon-indexer/db';

/**
 * SummaryStorage - Database persistence layer for summary-related operations
 *
 * This class handles all database operations for summary queries, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 * All business logic, data conversion, and processing happens in the controller layer.
 */
export class SummaryStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Calculate and save validator inactivity status and hourly statistics
   * This method calculates status based on the last N slots, gets validator beacon_status and balance,
   * and saves everything to validators_status_summary table in a single efficient query
   *
   * @param params - Parameters object
   * @param params.minSlotHour - Start slot of the last hour (inclusive)
   * @param params.maxSlotToQuery - End slot of the last hour (inclusive)
   * @param params.maxAttestationDelay - Maximum delay threshold (attestations with delay > this are considered missed)
   * @param params.inactiveMissedCount - Number of consecutive missed attestations to mark as inactive
   * @param params.inactivityCheckStartSlot - Start slot for inactivity check (inclusive). If not provided, defaults to maxSlotToQuery - inactiveMissedCount + 1
   */
  async validatorsStatusSummary(params: {
    minSlotHour: number;
    maxSlotToQuery: number;
    maxAttestationDelay: number;
    inactiveMissedCount: number;
    inactivityCheckStartSlot?: number;
  }): Promise<void> {
    const {
      minSlotHour,
      maxSlotToQuery,
      maxAttestationDelay,
      inactiveMissedCount,
      inactivityCheckStartSlot,
    } = params;

    // Calculate inactivityCheckStartSlot if not provided (defaults to maxSlotToQuery - inactiveMissedCount + 1)
    const minSlotStatus = inactivityCheckStartSlot ?? maxSlotToQuery - inactiveMissedCount + 1;

    // Truncate table to replace all existing data (separate call because $executeRaw cannot handle multiple commands)
    await this.prisma.$executeRaw`TRUNCATE TABLE validators_status_summary`;

    // Calculate and insert validator status summary in a single query
    await this.prisma.$executeRaw`
      WITH 
        user_validators AS (
          SELECT DISTINCT utv.validator_index
          FROM _user_to_validator utv
          JOIN validator v ON v.id = utv.validator_index
          WHERE v.status IN (2, 3)
        ),

        -- Base: all attestations from the last hour for your validators
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

        -- Attestations for status check: only from the status range (inactivityCheckStartSlot to maxSlotToQuery)
        -- This ensures we only check the last N attestations in the specified range
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
          WHERE a.slot >= ${minSlotStatus}::int
        ),

        -- Current status: look only at the last N attestations (inactiveMissedCount)
        -- A validator is inactive if they missed ALL of the last N attestations they should have made
        status AS (
          SELECT
            sa.validator_index,
            CASE 
              WHEN SUM(
                CASE WHEN sa.rn <= ${inactiveMissedCount}::int THEN sa.is_missed ELSE 0 END
              ) = ${inactiveMissedCount}::int
              THEN 'inactive'
              ELSE 'active'
            END AS status
          FROM status_attestations sa
          GROUP BY sa.validator_index
        ),

        -- Stats from the last hour: how many made and how many missed
        hourly AS (
          SELECT
            validator_index,
            COUNT(*)          AS attestations_total,
            SUM(is_missed)    AS attestations_missed
          FROM attestations
          GROUP BY validator_index
        ),

        -- Final result with validator beacon_status and balance
        summary_data AS (
          SELECT
            h.validator_index,
            COALESCE(s.status, 'active') AS status,  -- Default to active if no attestations in status range
            h.attestations_total,
            h.attestations_missed,
            -- Performance: percentage of successful attestations (0.0 to 100.0)
            CASE 
              WHEN h.attestations_total > 0 
              THEN ((h.attestations_total - h.attestations_missed)::float / h.attestations_total * 100)::numeric(5, 2)
              ELSE 0.0
            END AS performance,
            v.status AS beacon_status,
            v.balance
          FROM hourly h
          LEFT JOIN status s USING (validator_index)
          JOIN validator v ON v.id = h.validator_index
        )

      -- Insert directly into validators_status_summary table
      INSERT INTO validators_status_summary (
        validator_index,
        status,
        attestations_total,
        attestations_missed,
        performance,
        beacon_status,
        balance,
        updated_at
      )
      SELECT
        validator_index,
        status,
        attestations_total,
        attestations_missed,
        performance,
        beacon_status,
        balance,
        NOW()
      FROM summary_data
    `;
  }
}
