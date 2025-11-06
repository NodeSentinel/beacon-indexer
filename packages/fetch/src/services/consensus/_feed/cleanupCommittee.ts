import { CustomLogger } from '@/src/lib/pino.js';
import { getPrisma } from '@/src/lib/prisma.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';

const prisma = getPrisma();

export async function cleanupCommittee(logger: CustomLogger) {
  logger.info('Cleaning up committee...');
  let totalDeleted = 0;

  try {
    // remove attestations that were summarized in the hourly summary
    const lsu = await prisma.lastSummaryUpdate.findFirst();

    if (!lsu) {
      logger.info('No LastSummaryUpdate record found, skipping cleanup');
      return;
    }

    if (!lsu.hourlyValidatorStats) {
      logger.info('No hourlyValidatorStats timestamp found, skipping cleanup');
      return;
    }

    const maxSlot = getSlotNumberFromTimestamp(lsu.hourlyValidatorStats.getTime()) - 10; // 10 is some buffer just to be safe
    logger.info(`Deleting slots lower than ${maxSlot}`);

    if (maxSlot) {
      const result = await prisma.$executeRaw`DELETE FROM "committee" WHERE slot < ${maxSlot}`;
      totalDeleted += result;
    }

    logger.info(`Done! Deleted ${totalDeleted} records`);
  } catch (error) {
    logger.error(`Error cleaning up committee: ${error}`, error);
  }
}
