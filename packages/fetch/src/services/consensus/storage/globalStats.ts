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
 * GlobalStatsStorage - capa de persistencia para métricas globales diarias
 * Solo lógica de acceso a datos; nada de negocio.
 */
export class GlobalStatsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async countValidatorsByStatus(status: number) {
    return this.prisma.validator.count({ where: { status } });
  }

  /**
   * Suma y cuenta validadores con `where`, y devuelve promedios (floor) como bigint.
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
