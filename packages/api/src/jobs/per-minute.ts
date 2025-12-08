import cron from 'node-cron';

import { logger } from '@/lib/logger.js';
import { getPrisma } from '@/lib/prisma.js';

/**
 * Register per-minute jobs
 * These jobs run every minute for frequent checks
 */
export function registerPerMinuteJobs() {
  // Example: Check indexer health and log metrics
  cron.schedule('* * * * *', async () => {
    try {
      const prisma = getPrisma();

      // Quick health check
      const lastProcessedSlot = await prisma.slot.findFirst({
        where: { processed: true },
        orderBy: { slot: 'desc' },
        select: { slot: true },
      });

      if (lastProcessedSlot) {
        logger.debug({ lastProcessedSlot: lastProcessedSlot.slot }, 'Indexer status check');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in per-minute job');
    }
  });

  logger.info('Per-minute jobs registered');
}
