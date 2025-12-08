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
   * Get validator inactivity status and hourly statistics
   * Returns validators with their status based on the last N slots and hourly attestation statistics
   *
   * @param minSlotHour - Start slot of the last hour (inclusive)
   * @param maxSlotHour - End slot of the last hour (inclusive)
   * @param maxAttestationDelay - Maximum delay threshold (attestations with delay > this are considered missed)
   * @param statusSlots - Number of recent slots to use for determining active/inactive status
   * @returns Array of validator indices with status, total attestations, and missed attestations
   */
  async getValidatorInactivityStatus(
    minSlotHour: number,
    maxSlotHour: number,
    maxAttestationDelay: number,
    statusSlots: number,
  ): Promise<
    Array<{
      validator_index: number;
      status: 'active' | 'inactive';
      attestations_total: number;
      attestations_missed: number;
    }>
  > {
    return this.prisma.$queryRaw<
      Array<{
        validator_index: number;
        status: 'active' | 'inactive';
        attestations_total: number;
        attestations_missed: number;
      }>
    >`
      WITH 
        input_params AS (
          SELECT 
            ${minSlotHour}::int AS min_slot_hour,         -- slot start of the last hour
            ${maxSlotHour}::int AS max_slot_hour,         -- slot end of the last hour
            ${maxAttestationDelay}::int AS max_attestation_delay,
            ${statusSlots}::int AS status_slots           -- how many slots to use for "active/inactive"
        ),

        user_validators AS (
          SELECT DISTINCT uv."B" AS validator_id
          FROM _user_to_validator uv
          JOIN validator v ON v.id = uv."B"
          WHERE v.status IN (2, 3)
        ),

        -- Base: all attestations from the last hour for your validators
        attestations AS (
          SELECT
            c.validator_index,
            c.slot,
            (c.attestation_delay IS NULL 
              OR c.attestation_delay > ip.max_attestation_delay
            )::int AS is_missed,
            ROW_NUMBER() OVER (
              PARTITION BY c.validator_index 
              ORDER BY c.slot DESC
            ) AS rn
          FROM user_validators uv
          JOIN committee c 
            ON c.validator_index = uv.validator_id
          CROSS JOIN input_params ip
          WHERE c.slot BETWEEN ip.min_slot_hour AND ip.max_slot_hour
        ),

        -- Current status: look only at the last N slots (status_slots)
        status AS (
          SELECT
            a.validator_index,
            CASE 
              WHEN SUM(
                CASE WHEN a.rn <= ip.status_slots THEN a.is_missed ELSE 0 END
              ) = ip.status_slots
              THEN 'inactive'
              ELSE 'active'
            END AS status
          FROM attestations a
          CROSS JOIN input_params ip
          GROUP BY a.validator_index, ip.status_slots
        ),

        -- Stats from the last hour: how many made and how many missed
        hourly AS (
          SELECT
            validator_index,
            COUNT(*)          AS attestations_total,
            SUM(is_missed)    AS attestations_missed
          FROM attestations
          GROUP BY validator_index
        )

      SELECT
        h.validator_index,
        s.status,
        h.attestations_total,
        h.attestations_missed
      FROM hourly h
      JOIN status s USING (validator_index)
    `;
  }
}
