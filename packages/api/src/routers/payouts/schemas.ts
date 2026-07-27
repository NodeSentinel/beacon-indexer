import { z } from 'zod';

export const PayoutsInputSchema = z.object({
  clusterId: z.string(),
  page: z.number().int().positive().default(1),
});

export const PayoutEventSchema = z.object({
  slot: z.number(),
  index: z.string(),
  validatorIndex: z.number(),
  amount: z.string(),
  timestamp: z.number(),
});

export const PayoutsOutputSchema = z.object({
  payouts: z.array(PayoutEventSchema),
  hasNextPage: z.boolean(),
  page: z.number(),
});
