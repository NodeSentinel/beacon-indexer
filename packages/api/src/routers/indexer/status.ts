import { format } from 'date-fns';

import { IndexerStatusSchema } from './schemas.js';

import { publicProcedure } from '@/lib/orpc.js';
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
 * Get indexer status
 * Returns information about the current state of the indexer
 */
export const getStatus = publicProcedure
  .output(ApiResponseSchema(IndexerStatusSchema))
  .handler(async () => {
    const prisma = getPrisma();

    // Get current chain state
    const now = Date.now();
    const currentSlot = beaconTime.getSlotNumberFromTimestamp(now);

    // Get last processed epoch
    const lastProcessedEpoch = await prisma.epoch.findFirst({
      where: { processed: true },
      orderBy: { epoch: 'desc' },
      select: { epoch: true },
    });

    // Get last processed slot
    const lastProcessedSlot = await prisma.slot.findFirst({
      where: { processed: true },
      orderBy: { slot: 'desc' },
      select: { slot: true },
    });

    // Calculate distance to head
    let distanceToHead = {
      lagSlots: 0,
      lagTimeMs: 0,
      lagTimeFormatted: '00:00:00',
    };

    if (lastProcessedSlot) {
      const slotLag = currentSlot - lastProcessedSlot.slot;
      const timeLagMs = slotLag * chainConfig.beacon.slotDuration;
      distanceToHead = {
        lagSlots: slotLag,
        lagTimeMs: timeLagMs,
        lagTimeFormatted: formatTimeDistance(timeLagMs),
      };
    }

    // Build response
    const status = {
      lastProcessedEpoch: lastProcessedEpoch
        ? {
            epoch: lastProcessedEpoch.epoch,
          }
        : null,
      lastProcessedSlot: lastProcessedSlot
        ? {
            slot: lastProcessedSlot.slot,
            epoch: beaconTime.getEpochFromSlot(lastProcessedSlot.slot),
          }
        : null,
      distanceToHead,
    };

    return {
      success: true,
      data: status,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  });
