import cron from 'node-cron';

import { logger } from '@/lib/logger.js';

/**
 * Register hourly jobs
 * These jobs run every hour for data aggregation
 */
export function registerHourlyJobs() {
  // Run at the start of each hour (minute 0)
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Starting hourly aggregation job');

      // TODO: Implement hourly aggregation logic
      // Previously used lastSummaryUpdate table which has been removed
      // Hourly aggregations should now be computed from slot-level data

      logger.info('Hourly aggregation job completed');
    } catch (error) {
      logger.error({ err: error }, 'Error in hourly aggregation job');
    }
  });

  logger.info('Hourly jobs registered');
}
