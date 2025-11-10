import { PrismaClient } from '@beacon-indexer/db';

/**
 * GlobalStatsStorage - persistence layer for daily global metrics
 * Data-access only; no business logic.
 */
export class GlobalStatsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Single-shot raw SQL:
   *  - counts by status (pending_queued, active_ongoing, active_exiting)
   *  - averages over ACTIVE_ONGOING only (floored via integer division)
   *  - upsert into beacon_daily_validator_stats
   *
   * `statuses` are passed in by the controller to avoid coupling this layer to enum imports.
   */
  async upsertDailyValidatorStatsRaw(
    dayUtc: Date,
    statuses: { pendingQueued: number; activeOngoing: number; activeExiting: number },
  ) {
    const { pendingQueued, activeOngoing, activeExiting } = statuses;

    await this.prisma.$executeRaw`
      INSERT INTO "beacon_daily_validator_stats" (
        "date",
        "pending_queued",
        "active_ongoing",
        "active_exiting",
        "avg_balance",
        "avg_effective_balance"
      )
      SELECT
        (${dayUtc} AT TIME ZONE 'UTC')::date AS "date",

        -- counts by status
        COUNT(*) FILTER (WHERE "status" = ${pendingQueued}) AS "pending_queued",
        COUNT(*) FILTER (WHERE "status" = ${activeOngoing}) AS "active_ongoing",
        COUNT(*) FILTER (WHERE "status" = ${activeExiting}) AS "active_exiting",

        -- averages over ACTIVE_ONGOING only (floored bigint)
        CASE
          WHEN COUNT(*) FILTER (WHERE "status" = ${activeOngoing}) > 0
          THEN (SUM("balance") FILTER (WHERE "status" = ${activeOngoing}))::bigint
               / (COUNT(*) FILTER (WHERE "status" = ${activeOngoing}))::bigint
          ELSE NULL
        END AS "avg_balance",

        CASE
          WHEN COUNT("effective_balance") FILTER (WHERE "status" = ${activeOngoing}) > 0
          THEN (SUM("effective_balance") FILTER (WHERE "status" = ${activeOngoing}))::bigint
               / (COUNT("effective_balance") FILTER (WHERE "status" = ${activeOngoing}))::bigint
          ELSE NULL
        END AS "avg_effective_balance"
      FROM "validator"
      WHERE "status" IN (${pendingQueued}, ${activeOngoing}, ${activeExiting})

      ON CONFLICT ("date") DO UPDATE SET
        "pending_queued"        = EXCLUDED."pending_queued",
        "active_ongoing"        = EXCLUDED."active_ongoing",
        "active_exiting"        = EXCLUDED."active_exiting",
        "avg_balance"           = EXCLUDED."avg_balance",
        "avg_effective_balance" = EXCLUDED."avg_effective_balance";
    `;
  }
}
