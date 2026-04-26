import cron from 'node-cron';

import type { Logger } from '@/lib/logger.js';

/**
 * Registers the daily jobs.
 */
export function registerDailyJobs(logger: Logger) {
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Starting daily aggregation job');
      logger.info('Daily aggregation job completed');
    } catch (error) {
      logger.error({ err: error }, 'Error in daily aggregation job');
    }
  });

  logger.info('Daily jobs registered');
}
