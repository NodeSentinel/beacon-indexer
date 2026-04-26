/* eslint-disable @typescript-eslint/no-explicit-any */
import { format } from 'date-fns';

import { IndexerStatusSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Formats a lag duration for the API response.
 */
function formatTimeDistance(ms: number): string {
  return format(new Date(ms), 'HH:mm:ss');
}

/**
 * Formats a slot timestamp for the API response.
 */
function formatTimestamp(timestamp: number): string {
  return format(new Date(timestamp), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Creates the indexer status route.
 */
export function createIndexerStatusRoute(params: {
  beaconHelpers: {
    beaconTime: {
      getSlotNumberFromTimestamp: (timestamp: number) => number;
      getTimestampFromSlotNumber: (slot: number) => number;
    };
    chainConfig: { beacon: { slotDuration: number } };
  };
  prisma: any;
  procedures: ApiProcedures;
  systemConfigController: {
    getArchive: () => Promise<any>;
    getIndexerConfig: () => Promise<any>;
  };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/indexer/status' })
    .output(ApiResponseSchema(IndexerStatusSchema))
    .handler(async () => {
      const now = Date.now();
      const currentSlot = params.beaconHelpers.beaconTime.getSlotNumberFromTimestamp(now);

      const lastProcessedEpochRecord = await params.prisma.epoch.findFirst({
        where: { processed: true },
        orderBy: { epoch: 'desc' },
        select: { epoch: true },
      });

      const lastProcessedSlotRecord = await params.prisma.slot.findFirst({
        where: { processed: true },
        orderBy: { slot: 'desc' },
        select: { slot: true },
      });

      const [archive, indexerConfig] = await Promise.all([
        params.systemConfigController.getArchive(),
        params.systemConfigController.getIndexerConfig(),
      ]);

      let distanceToHead = {
        headSlot: currentSlot,
        lagSlots: 0,
        lagTimeMs: 0,
        lagTimeFormatted: '00:00:00',
      };

      if (lastProcessedSlotRecord) {
        const slotLag = currentSlot - lastProcessedSlotRecord.slot;
        const timeLagMs = slotLag * params.beaconHelpers.chainConfig.beacon.slotDuration;
        distanceToHead = {
          headSlot: currentSlot,
          lagSlots: slotLag,
          lagTimeMs: timeLagMs,
          lagTimeFormatted: formatTimeDistance(timeLagMs),
        };
      }

      const lastProcessedSlotTimestamp = lastProcessedSlotRecord
        ? params.beaconHelpers.beaconTime.getTimestampFromSlotNumber(lastProcessedSlotRecord.slot)
        : null;

      return {
        success: true,
        data: {
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
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });
}
