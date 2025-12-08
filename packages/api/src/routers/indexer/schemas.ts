import { z } from 'zod';

/**
 * Indexer status response schema
 */
export const IndexerStatusSchema = z.object({
  lastProcessedEpoch: z
    .object({
      epoch: z.number().int(),
    })
    .nullable(),
  lastProcessedSlot: z
    .object({
      slot: z.number().int(),
      epoch: z.number().int(),
    })
    .nullable(),
  distanceToHead: z.object({
    lagSlots: z.number().int().describe('Number of slots behind the chain head'),
    lagTimeMs: z.number().int().describe('Time lag in milliseconds behind the chain head'),
    lagTimeFormatted: z.string().describe('Time lag formatted as HH:mm:ss'),
  }),
});

export type IndexerStatus = z.infer<typeof IndexerStatusSchema>;
