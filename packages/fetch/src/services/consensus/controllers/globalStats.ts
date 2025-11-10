import { GlobalStatsStorage } from '../storage/globalStats.js';

import { VALIDATOR_STATUS } from '@/src/services/consensus/constants.js';
import { convertToUTC } from '@/src/utils/date/index.js';

export class GlobalStatsController {
  constructor(private readonly storage: GlobalStatsStorage) {}

  async runDailyAggregation(when: Date = new Date()) {
    // Normalize to UTC start-of-day using existing helper
    const { date } = convertToUTC(when); // 'yyyy-MM-dd' in UTC
    const dayUtc = new Date(`${date}T00:00:00.000Z`);

    // Single-shot aggregation + upsert (no multiple round-trips)
    await this.storage.upsertDailyValidatorStatsRaw(dayUtc, {
      pendingQueued: VALIDATOR_STATUS.pending_queued,
      activeOngoing: VALIDATOR_STATUS.active_ongoing,
      activeExiting: VALIDATOR_STATUS.active_exiting,
    });

    // Optional: return a minimal snapshot (can re-select if you need exact persisted values)
    return { date: dayUtc };
  }
}
