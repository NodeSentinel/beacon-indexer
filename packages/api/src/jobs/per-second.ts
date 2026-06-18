import cron from 'node-cron';

import type { Logger } from '@/lib/logger.js';

/**
 * Registers the per-second jobs.
 */
export function registerPerSecondJobs(logger: Logger) {
  cron.schedule('* * * * * *', async () => {
    try {
      // Placeholder for future lightweight background work.
    } catch (error) {
      logger.error({ err: error }, 'Error in per-second job');
    }
  });

  logger.info('Per-second jobs registered');
}
