import { z } from 'zod';

export const WithdrawalsInputSchema = z.object({
  clusterId: z.string(),
  page: z.number().int().positive().default(1),
});

export const WithdrawalEventSchema = z.object({
  slot: z.number(),
  requestIndex: z.number(),
  type: z.enum(['partial', 'full_exit']),
  validatorIndex: z.number(),
  pubkey: z.string(),
  sourceAddress: z.string().nullable(),
  amount: z.string(),
  timestamp: z.number(),
});

export const WithdrawalsOutputSchema = z.object({
  withdrawals: z.array(WithdrawalEventSchema),
  hasNextPage: z.boolean(),
  page: z.number(),
});
