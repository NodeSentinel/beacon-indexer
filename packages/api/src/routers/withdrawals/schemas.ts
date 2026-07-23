import { z } from 'zod';

export const WithdrawalsInputSchema = z.object({
  clusterId: z.string(),
  page: z.number().int().positive().default(1),
});

export const WithdrawalEventSchema = z.object({
  slot: z.number(),
  source: z.enum(['payload', 'execution_request']),
  index: z.string(),
  validatorIndex: z.number(),
  pubkey: z.string().nullable(),
  sourceAddress: z.string().nullable(),
  amount: z.string(),
  timestamp: z.number(),
});

export const WithdrawalsOutputSchema = z.object({
  withdrawals: z.array(WithdrawalEventSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
