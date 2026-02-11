import { Prisma, PrismaClient } from '@beacon-indexer/db';

export class ChainStatsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async getLastProcessedEpoch(): Promise<number | null> {
    const result = await this.prisma.chainEpochStats.findFirst({
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
    });
    return result?.epoch ?? null;
  }

  /**
   * Single-shot raw SQL: aggregates validator stats and consolidation requests,
   * then inserts into chain_epoch_stats.
   *
   * Status codes are passed in from the controller to avoid coupling.
   */
  async insertChainEpochStats(
    epoch: number,
    activeStatuses: number[],
    enteringStatuses: number[],
    exitingStatus: number,
    startSlot: number,
    endSlot: number,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO "chain_epoch_stats" (
        "epoch",
        "total_active_validators",
        "total_staked",
        "validators_entering",
        "validators_exiting",
        "validators_consolidating"
      )
      SELECT
        ${epoch}::int AS "epoch",

        -- Active validators: active_ongoing + active_exiting + active_slashed
        (SELECT COUNT(*)::int FROM "validator" WHERE "status" IN (${Prisma.join(activeStatuses)}))
          AS "total_active_validators",

        -- Total staked: sum of effective_balance for active validators
        (SELECT COALESCE(SUM("effective_balance"), 0) FROM "validator" WHERE "status" IN (${Prisma.join(activeStatuses)}))
          AS "total_staked",

        -- Validators entering: pending_initialized + pending_queued
        (SELECT COUNT(*)::int FROM "validator" WHERE "status" IN (${Prisma.join(enteringStatuses)}))
          AS "validators_entering",

        -- Validators exiting: active_exiting only
        (SELECT COUNT(*)::int FROM "validator" WHERE "status" = ${exitingStatus})
          AS "validators_exiting",

        -- Validators consolidating: distinct source pubkeys in consolidation requests for this epoch's slot range
        (SELECT COUNT(DISTINCT "source_pubkey")::int FROM "validator_request_consolidations"
         WHERE "slot" >= ${startSlot} AND "slot" <= ${endSlot})
          AS "validators_consolidating"

      ON CONFLICT ("epoch") DO NOTHING;
    `;
  }
}
