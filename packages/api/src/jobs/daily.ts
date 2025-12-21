import cron from 'node-cron';

import { logger } from '@/lib/logger.js';

/**
 * Register daily jobs
 * These jobs run once per day for daily aggregations
 */
export function registerDailyJobs() {
  // Run at midnight UTC (00:00)
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
