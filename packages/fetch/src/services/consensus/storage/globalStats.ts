import { PrismaClient, Prisma } from '@beacon-indexer/db';

export type DailyActiveCounts = {
  pendingQueued: number;
  activeOngoing: number;
  activeExiting: number;
};

export type DailyAverages = {
  balance: bigint | null;
  effectiveBalance: bigint | null;
};

/**
 * GlobalStatsStorage - persistence layer for daily global metrics
 * Data-access logic only; no business logic.
 */
export class GlobalStatsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async countValidatorsByStatus(status: number) {
    return this.prisma.validator.count({ where: { status } });
  }

  /**
   * Sums and counts validators with `where`, and returns averages (floored) as bigint.
   */
  async computeAverages(where: Prisma.ValidatorWhereInput): Promise<DailyAverages> {
    const agg = await this.prisma.validator.aggregate({
      where,
      _sum: { balance: true, effectiveBalance: true },
      _count: { _all: true },
    });

    const count = agg._count?._all ?? 0;
    if (count === 0) return { balance: null, effectiveBalance: null };

    const sumBalance = BigInt(agg._sum.balance ?? 0);
    const sumEffective = BigInt(agg._sum.effectiveBalance ?? 0);
    const denom = BigInt(count);

    return {
      balance: sumBalance / denom,
      effectiveBalance: sumEffective / denom,
    };
  }

  async upsertDailyActiveValidators(date: Date, counts: DailyActiveCounts) {
    return this.prisma.beaconDailyActiveValidators.upsert({
      where: { date },
      create: { date, ...counts },
      update: { ...counts },
    });
  }

  async upsertDailyAverageBalances(date: Date, averages: DailyAverages) {
    return this.prisma.beaconDailyAverageBalances.upsert({
      where: { date },
      create: { date, ...averages },
      update: { ...averages },
    });
  }
}
