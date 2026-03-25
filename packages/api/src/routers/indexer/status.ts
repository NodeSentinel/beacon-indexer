import { format } from 'date-fns';

import { IndexerStatusSchema } from './schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
import { SystemConfigController } from '@/controllers/systemConfig.js';
import { getPrisma } from '@/lib/prisma.js';
import { beaconTime, chainConfig } from '@/utils/beaconTime.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Format milliseconds to hh:mm:ss format using date-fns format
 * @param ms - Milliseconds to format
 * @returns Formatted string in hh:mm:ss format
 */
function formatTimeDistance(ms: number): string {
  const durationDate = new Date(ms);
  return format(durationDate, 'HH:mm:ss');
}

/**
 * Format timestamp to yyyy-MM-dd HH:mm:ss format using date-fns
 * @param timestamp - Timestamp in milliseconds
 * @returns Formatted string in yyyy-MM-dd HH:mm:ss format
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return format(date, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Get indexer status
 * Returns information about the current state of the indexer
 */
export const getStatus = securedProcedure
  .route({ method: 'GET', path: '/indexer/status' })
  .output(ApiResponseSchema(IndexerStatusSchema))
  .handler(async () => {
    const prisma = getPrisma();
    const systemConfigController = new SystemConfigController();

    // Get current chain state
    const now = Date.now();
    const currentSlot = beaconTime.getSlotNumberFromTimestamp(now);

    // Get last processed epoch
    const lastProcessedEpochRecord = await prisma.epoch.findFirst({
      where: { processed: true },
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
    });

    // Get last processed slot
    const lastProcessedSlotRecord = await prisma.slot.findFirst({
      where: { processed: true },
      orderBy: { slot: 'desc' },
      select: { slot: true },
    });

    // Get system configuration data
    const [archive, indexerConfig] = await Promise.all([
      systemConfigController.getArchive(),
      systemConfigController.getIndexerConfig(),
    ]);

    // Calculate distance to head
    let distanceToHead = {
      headSlot: currentSlot,
      lagSlots: 0,
      lagTimeMs: 0,
      lagTimeFormatted: '00:00:00',
    };

    if (lastProcessedSlotRecord) {
      const slotLag = currentSlot - lastProcessedSlotRecord.slot;
      const timeLagMs = slotLag * chainConfig.beacon.slotDuration;
      distanceToHead = {
        headSlot: currentSlot,
        lagSlots: slotLag,
        lagTimeMs: timeLagMs,
        lagTimeFormatted: formatTimeDistance(timeLagMs),
      };
    }

    // Build response
    const lastProcessedSlotTimestamp = lastProcessedSlotRecord
      ? beaconTime.getTimestampFromSlotNumber(lastProcessedSlotRecord.slot)
      : null;

    const status = {
      lastProcessedEpoch: lastProcessedEpochRecord?.epoch ?? null,
      lastProcessedSlot:
        lastProcessedSlotRecord && lastProcessedSlotTimestamp
          ? {
              slot: lastProcessedSlotRecord.slot,
              timestamp: lastProcessedSlotTimestamp,
              timeFormatted: formatTimestamp(lastProcessedSlotTimestamp),
            }
          : null,
      distanceToHead,
      archive,
      indexerConfig,
    };

    return {
      success: true,
      data: status,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  });
