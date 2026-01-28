import { z } from 'zod';

/**
 * Indexer status response schema
 */
export const IndexerStatusSchema = z.object({
  lastProcessedEpoch: z.number().int().nullable(),
  lastProcessedSlot: z
    .object({
      slot: z.number().int(),
      timestamp: z.number().int().describe('Timestamp in milliseconds'),
      timeFormatted: z.string().describe('Formatted time as yyyy-mm-dd hh:mm:ss'),
    })
    .nullable(),
  distanceToHead: z.object({
    headSlot: z.number().int().describe('Current chain head slot'),
    lagSlots: z.number().int().describe('Number of slots behind the chain head'),
    lagTimeMs: z.number().int().describe('Time lag in milliseconds behind the chain head'),
    lagTimeFormatted: z.string().describe('Time lag formatted as HH:mm:ss'),
  }),
  archive: z
    .object({
      lastHour: z.date().nullable(),
      lastDay: z.date().nullable(),
      lastWeek: z.date().nullable(),
      lastMonth: z.date().nullable(),
    })
    .nullable(),
  indexerConfig: z
    .object({
      chain: z.string(),
      lookbackSlot: z.number().int(),
      createdAt: z.date(),
    })
    .nullable(),
});

export type IndexerStatus = z.infer<typeof IndexerStatusSchema>;
