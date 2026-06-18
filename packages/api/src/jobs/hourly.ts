import cron from 'node-cron';

import type { Logger } from '@/lib/logger.js';

/**
 * Registers the hourly jobs.
 */
export function registerHourlyJobs(logger: Logger) {
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Starting hourly aggregation job');
      logger.info('Hourly aggregation job completed');
    } catch (error) {
      logger.error({ err: error }, 'Error in hourly aggregation job');
    }
  });

  logger.info('Hourly jobs registered');
}
