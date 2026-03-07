import { z } from 'zod';

export const BlockProposalsInputSchema = z
  .object({
    clusterId: z.string().optional(),
    validatorIndex: z.number().int().nonnegative().optional(),
    page: z.number().int().positive().default(1),
  })
  .refine((data) => data.clusterId !== undefined || data.validatorIndex !== undefined, {
    message: 'Either clusterId or validatorIndex must be provided',
  })
  .refine((data) => !(data.clusterId !== undefined && data.validatorIndex !== undefined), {
    message: 'Only one of clusterId or validatorIndex can be provided',
  });

export const BlockProposalSchema = z.object({
  slot: z.number(),
  blockNumber: z.number().nullable(),
  validatorIndex: z.number(),
  timestamp: z.number(),
  consensusReward: z.string().nullable(),
  executionReward: z.string().nullable(),
});

export const BlockProposalsOutputSchema = z.object({
  blocks: z.array(BlockProposalSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
