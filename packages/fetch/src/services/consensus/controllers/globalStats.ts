import { GlobalStatsStorage } from '../storage/globalStats.js';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';

type Dateish = Date | string | number;

function startOfUtcDay(d: Dateish) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/**
 * GlobalStatsController - business layer for daily global metrics
 * Receives storage via injection, like the other controllers.
 */
export class GlobalStatsController {
  constructor(private readonly storage: GlobalStatsStorage) {}

  /**
   * Aggregates and persists:
   *  - Active validators (pending_queued, active_ongoing, active_exiting)
   *  - Average balances over active_ongoing
   *
   * Returns a consolidated snapshot of the day.
   */
  async runDailyAggregation(when: Dateish = new Date()) {
    const dayUtc = startOfUtcDay(when);

    // 1) Counts by status
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

    // 2) Averages over ongoing-active validators
    const averages = await this.storage.computeAverages({
      status: VALIDATOR_STATUS.active_ongoing,
    });

    await this.storage.upsertDailyAverageBalances(dayUtc, averages);

    // 3) Snapshot (useful for logs/tests)
    return {
      date: dayUtc,
      activeValidators: { pendingQueued, activeOngoing, activeExiting },
      averages,
    };
  }
}
