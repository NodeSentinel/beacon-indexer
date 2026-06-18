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
        "entering_staked",
        "validators_exiting",
        "validators_consolidating"
      )
      SELECT
        ${epoch}::int AS "epoch",
        v.total_active_validators,
        v.total_staked,
        v.validators_entering + d.deposit_entering AS "validators_entering",
        v.entering_staked + d.deposit_staked AS "entering_staked",
        v.validators_exiting,
        c.validators_consolidating
      FROM
        (
          SELECT
            COUNT(CASE WHEN "status" IN (${Prisma.join(activeStatuses)}) THEN 1 END)::int AS "total_active_validators",
            COALESCE(SUM(CASE WHEN "status" IN (${Prisma.join(activeStatuses)}) THEN "effective_balance" END), 0) AS "total_staked",
            COUNT(CASE WHEN "status" IN (${Prisma.join(enteringStatuses)}) THEN 1 END)::int AS "validators_entering",
            COALESCE(SUM(CASE WHEN "status" IN (${Prisma.join(enteringStatuses)}) THEN "effective_balance" END), 0)::bigint AS "entering_staked",
            COUNT(CASE WHEN "status" = ${exitingStatus} THEN 1 END)::int AS "validators_exiting"
          FROM "validator"
        ) AS v,
        (
          SELECT
            COUNT(DISTINCT d."pubkey")::int AS "deposit_entering",
            COALESCE(SUM(d."amount"), 0)::bigint AS "deposit_staked"
          FROM "validator_deposits" d
          LEFT JOIN "validator" vv ON d."pubkey" = vv."pubkey"
          WHERE vv."id" IS NULL
        ) AS d,
        (
          SELECT COUNT(DISTINCT "source_pubkey")::int AS "validators_consolidating"
          FROM "validator_request_consolidations"
          WHERE "slot" >= ${startSlot} AND "slot" <= ${endSlot}
        ) AS c
      ON CONFLICT ("epoch") DO NOTHING;
    `;
  }
}
