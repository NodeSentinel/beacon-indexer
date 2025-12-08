import cron from 'node-cron';

import { logger } from '@/lib/logger.js';
import { getPrisma } from '@/lib/prisma.js';

/**
 * Register daily jobs
 * These jobs run once per day for daily aggregations
 */
export function registerDailyJobs() {
  // Run at midnight UTC (00:00)
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Starting daily aggregation job');

      const prisma = getPrisma();

      // Example: Update daily validator stats
      // This would typically aggregate data from the last day
      // For now, this is a placeholder - implement actual aggregation logic
      // You can reuse logic from the indexer's GlobalStatsController

      // Check last summary update
      const lastUpdate = await prisma.lastSummaryUpdate.findUnique({
        where: { id: 1 },
        select: { dailyValidatorStats: true },
      });

      logger.info(
        { lastDailyUpdate: lastUpdate?.dailyValidatorStats },
        'Daily aggregation job completed',
      );
    } catch (error) {
      logger.error({ err: error }, 'Error in daily aggregation job');
    }
  });

  logger.info('Daily jobs registered');
}
