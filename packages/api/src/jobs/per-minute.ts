import type { PrismaClient } from '@beacon-indexer/db';
import cron from 'node-cron';

import type { Logger } from '@/lib/logger.js';

/**
 * Registers the per-minute jobs.
 */
export function registerPerMinuteJobs(params: { logger: Logger; prisma: PrismaClient }) {
  cron.schedule('* * * * *', async () => {
    try {
      const lastProcessedSlot = await params.prisma.slot.findFirst({
        where: { processed: true },
        orderBy: { slot: 'desc' },
        select: { slot: true },
      });

      if (lastProcessedSlot) {
        params.logger.debug({ lastProcessedSlot: lastProcessedSlot.slot }, 'Indexer status check');
      }
    } catch (error) {
      params.logger.error({ err: error }, 'Error in per-minute job');
    }
  });

  params.logger.info('Per-minute jobs registered');
}
