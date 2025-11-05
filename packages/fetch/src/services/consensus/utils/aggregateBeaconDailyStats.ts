import { PrismaClient } from '@beacon-indexer/db';

import { GlobalStatsController } from '../controllers/globalStats.js';
import { GlobalStatsStorage } from '../storage/globalStats.js';

/**
 * Single exported trigger to fire the daily aggregation.
 * Keeps the dependency pattern (prisma -> storage -> controller).
 */
export async function triggerBeaconDailyAggregation(when: Date = new Date()) {
  const prisma = new PrismaClient();
  try {
    const controller = new GlobalStatsController(new GlobalStatsStorage(prisma));
    return await controller.runDailyAggregation(when);
  } finally {
    await prisma.$disconnect();
  }
}
