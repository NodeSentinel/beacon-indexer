import { PrismaClient } from '@beacon-indexer/db';

import { GlobalStatsController } from '../controllers/globalStats.js';
import { GlobalStatsStorage } from '../storage/globalStats.js';

/**
 * ÚNICO trigger exportado para disparar la agregación diaria.
 * Mantiene el patrón de dependencias (prisma -> storage -> controller).
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
