import cron from 'node-cron';

import { logger } from '@/lib/logger.js';
import { getPrisma } from '@/lib/prisma.js';

/**
 * Register hourly jobs
 * These jobs run every hour for data aggregation
 */
export function registerHourlyJobs() {
  // Run at the start of each hour (minute 0)
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Starting hourly aggregation job');

      const prisma = getPrisma();

      // Example: Update hourly validator stats
      // This would typically aggregate data from the last hour
      // For now, this is a placeholder - implement actual aggregation logic
      // based on your requirements

      // Check last summary update
      const lastUpdate = await prisma.lastSummaryUpdate.findUnique({
        where: { id: 1 },
        select: { hourlyValidatorStats: true },
      });

      logger.info(
        { lastHourlyUpdate: lastUpdate?.hourlyValidatorStats },
        'Hourly aggregation job completed',
      );
    } catch (error) {
      logger.error({ err: error }, 'Error in hourly aggregation job');
    }
  });

  logger.info('Hourly jobs registered');
}
