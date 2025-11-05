import { GlobalStatsStorage } from '../storage/globalStats.js';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';

type Dateish = Date | string | number;

function startOfUtcDay(d: Dateish) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/**
 * GlobalStatsController - capa de negocio para métricas diarias globales
 * Recibe storage por inyección, como el resto de controllers.
 */
export class GlobalStatsController {
  constructor(private readonly storage: GlobalStatsStorage) {}

  /**
   * Agrega y persiste:
   *  - Active validators (pending_queued, active_ongoing, active_exiting)
   *  - Average balances sobre active_ongoing
   *
   * Devuelve un snapshot consolidado del día.
   */
  async runDailyAggregation(when: Dateish = new Date()) {
    const dayUtc = startOfUtcDay(when);

    // 1) Conteos por estado
    const [pendingQueued, activeOngoing, activeExiting] = await Promise.all([
      this.storage.countValidatorsByStatus(VALIDATOR_STATUS.pending_queued),
      this.storage.countValidatorsByStatus(VALIDATOR_STATUS.active_ongoing),
      this.storage.countValidatorsByStatus(VALIDATOR_STATUS.active_exiting),
    ]);

    await this.storage.upsertDailyActiveValidators(dayUtc, {
      pendingQueued,
      activeOngoing,
      activeExiting,
    });

    // 2) Promedios sobre activos en curso
    const averages = await this.storage.computeAverages({
      status: VALIDATOR_STATUS.active_ongoing,
    });

    await this.storage.upsertDailyAverageBalances(dayUtc, averages);

    // 3) Snapshot (útil para logs/tests)
    return {
      date: dayUtc,
      activeValidators: { pendingQueued, activeOngoing, activeExiting },
      averages,
    };
  }
}
