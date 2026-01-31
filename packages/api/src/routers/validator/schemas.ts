import { z } from 'zod';

/**
 * Validator getDetails input schema - accepts id as path parameter
 * id can be either a number (validatorIndex) or a string (pubkey, 98 chars)
 */
export const ValidatorGetDetailsInputSchema = z.object({
  id: z.union([z.number().int().positive(), z.string()]),
});

export type ValidatorGetDetailsInput = z.infer<typeof ValidatorGetDetailsInputSchema>;

/**
 * Attestation schema for slot-level data
 */
export const AttestationSchema = z.object({
  indexInEpoch: z.number().int(),
  aggregationBitsIndex: z.number().int(),
  delay: z.number().int().nullable(),
});

/**
 * Block rewards schema for slot-level data
 */
export const BlockRewardsSchema = z.object({
  blockReward: z.string().nullable(),
});

/**
 * Sync rewards schema for slot-level data
 */
export const SyncRewardsSchema = z.object({
  syncCommittee: z.string().nullable(),
});

/**
 * Slot schema with attestation and rewards
 */
export const SlotSchema = z.object({
  slot: z.number().int(),
  attestation: AttestationSchema,
  blockRewards: BlockRewardsSchema,
  syncRewards: SyncRewardsSchema,
});

/**
 * Epoch rewards schema
 */
export const EpochRewardsSchema = z.object({
  head: z.string(),
  target: z.string(),
  source: z.string(),
  inactivity: z.string(),
  missedHead: z.string(),
  missedTarget: z.string(),
  missedSource: z.string(),
  missedInactivity: z.string(),
});

/**
 * Epoch schema with rewards and slot
 * A validator attests only once per epoch, so there's a single slot object
 */
export const EpochSchema = z.object({
  epoch: z.number().int(),
  rewards: EpochRewardsSchema,
  slot: SlotSchema.nullable(),
});

/**
 * Performance summary schema
 */
export const PerformanceSummarySchema = z.object({
  attestationsTotal: z.number().int(),
  attestationsMissed: z.number().int(),
  performancePercentage: z.number(),
  maxAttestationDelay: z.number().int(),
});

/**
 * Validator status schema - id (numeric) and value (Beacon API string)
 */
export const ValidatorStatusSchema = z
  .object({
    id: z.number().int(),
    value: z.string(),
  })
  .nullable();

/**
 * Validator info schema
 */
export const ValidatorInfoSchema = z.object({
  id: z.number().int(),
  pubkey: z.string().nullable(),
  withdrawalAddress: z.string().nullable(),
  status: ValidatorStatusSchema,
  balance: z.string(),
  effectiveBalance: z.string().nullable(),
});

/**
 * Validator details response schema
 */
export const ValidatorDetailsSchema = z.object({
  validatorInfo: ValidatorInfoSchema,
  performanceSummary: PerformanceSummarySchema,
  epochs: z.array(EpochSchema),
});

export type ValidatorDetails = z.infer<typeof ValidatorDetailsSchema>;
export type ValidatorInfo = z.infer<typeof ValidatorInfoSchema>;
export type PerformanceSummary = z.infer<typeof PerformanceSummarySchema>;
export type Epoch = z.infer<typeof EpochSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Attestation = z.infer<typeof AttestationSchema>;
export type EpochRewards = z.infer<typeof EpochRewardsSchema>;
