import { z } from 'zod';

export const ConsolidationsInputSchema = z.object({
  clusterId: z.string(),
  page: z.number().int().positive().default(1),
});

export const ConsolidationEventSchema = z.object({
  slot: z.number(),
  requestIndex: z.number(),
  sourceAddress: z.string().nullable(),
  sourcePubkey: z.string(),
  targetPubkey: z.string(),
  sourceValidatorIndex: z.number(),
  targetValidatorIndex: z.number().nullable(),
  timestamp: z.number(),
});

export const ConsolidationsOutputSchema = z.object({
  consolidations: z.array(ConsolidationEventSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
