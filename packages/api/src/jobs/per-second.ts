import cron from 'node-cron';

import { logger } from '@/lib/logger.js';

/**
 * Register per-second jobs
 * These are very light jobs that run every second
 */
export function registerPerSecondJobs() {
  // Example: Update cached current slot/epoch
  // This can be useful for real-time monitoring
  cron.schedule('* * * * * *', async () => {
    try {
      // Light operations only - avoid heavy DB queries here
      // This is just a placeholder for future lightweight operations
      // logger.debug('Per-second job executed');
    } catch (error) {
      logger.error({ err: error }, 'Error in per-second job');
    }
  });

  logger.info('Per-second jobs registered');
}
