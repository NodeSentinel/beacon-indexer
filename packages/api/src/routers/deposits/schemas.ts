import { z } from 'zod';

export const DepositsInputSchema = z.object({
  clusterId: z.string(),
  page: z.number().int().positive().default(1),
});

export const DepositEventSchema = z.object({
  slot: z.number(),
  source: z.enum(['body', 'execution_request']),
  index: z.number(),
  pubkey: z.string(),
  withdrawalCredentials: z.string(),
  amount: z.string(),
  validatorIndex: z.number(),
  timestamp: z.number(),
});

export const DepositsOutputSchema = z.object({
  deposits: z.array(DepositEventSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
