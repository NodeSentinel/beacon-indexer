import { isAddress } from 'viem';
import { z } from 'zod';

/**
 * Ethereum address schema using viem's isAddress
 */
const ethereumAddressSchema = z
  .string()
  .refine((val) => isAddress(val), { message: 'Invalid Ethereum address' });

/**
 * Cluster visibility enum
 */
export const ClusterVisibilitySchema = z.enum(['private', 'shared']);

export type ClusterVisibility = z.infer<typeof ClusterVisibilitySchema>;

/**
 * Create cluster input schema
 */
export const CreateClusterInputSchema = z.object({
  name: z.string().min(1).max(100),
  visibility: ClusterVisibilitySchema.default('private'),
  feeRecipientAddress: ethereumAddressSchema.nullable().optional(),
  ownerId: z.string(),
});

export type CreateClusterInput = z.infer<typeof CreateClusterInputSchema>;

/**
 * List clusters input schema - requires ownerId
 */
export const ListClustersInputSchema = z.object({
  ownerId: z.string(),
});

export type ListClustersInput = z.infer<typeof ListClustersInputSchema>;

/**
 * Cluster ID path parameter schema
 */
export const ClusterIdParamSchema = z.object({
  id: z.string(),
});

export type ClusterIdParam = z.infer<typeof ClusterIdParamSchema>;

/**
 * Update cluster input schema
 */
export const UpdateClusterInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  visibility: ClusterVisibilitySchema.optional(),
  feeRecipientAddress: ethereumAddressSchema.nullable().optional(),
});

export type UpdateClusterInput = z.infer<typeof UpdateClusterInputSchema>;

/**
 * Add validators input schema (base object)
 * Either validatorIndexes OR withdrawalAddress must be provided (not both)
 */
export const AddValidatorsInputSchema = z.object({
  validatorIndexes: z.array(z.number().int().nonnegative()).min(1).optional(),
  withdrawalAddress: z.string().length(42).optional(),
});

/**
 * Refined version with validation (use this for validation after parsing)
 */
export const AddValidatorsInputRefinedSchema = AddValidatorsInputSchema.refine(
  (data) => (data.validatorIndexes !== undefined) !== (data.withdrawalAddress !== undefined),
  { message: 'Exactly one of validatorIndexes or withdrawalAddress must be provided' },
);

export type AddValidatorsInput = z.infer<typeof AddValidatorsInputSchema>;

/**
 * Remove validators input schema (base object)
 * Either validatorIndexes OR withdrawalAddress must be provided (not both)
 */
export const RemoveValidatorsInputSchema = z.object({
  validatorIndexes: z.array(z.number().int().nonnegative()).min(1).optional(),
  withdrawalAddress: z.string().length(42).optional(),
});

export type RemoveValidatorsInput = z.infer<typeof RemoveValidatorsInputSchema>;

/**
 * Remove validators response schema
 */
export const RemoveValidatorsResponseSchema = z.object({
  removed: z.number(),
});

/**
 * Base cluster response schema
 */
export const ClusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: ClusterVisibilitySchema,
  feeRecipientAddress: z.string().nullable(),
  ownerId: z.string(),
  createdAt: z.string(),
});

export type Cluster = z.infer<typeof ClusterSchema>;

/**
 * Cluster with validator count (for list endpoint)
 */
export const ClusterWithCountSchema = ClusterSchema.extend({
  validatorCount: z.number(),
});

export type ClusterWithCount = z.infer<typeof ClusterWithCountSchema>;

/**
 * Cluster validator detail schema
 */
export const ClusterValidatorDetailSchema = z.object({
  validatorIndex: z.number(),
  withdrawalAddress: z.string().nullable(),
  status: z.number().nullable(),
  balance: z.string(),
  effectiveBalance: z.string().nullable(),
  pubkey: z.string().nullable(),
});

export type ClusterValidatorDetail = z.infer<typeof ClusterValidatorDetailSchema>;

/**
 * Cluster detail schema (for get endpoint) - includes validators and derived withdrawalAddresses
 */
export const ClusterDetailSchema = ClusterSchema.extend({
  validators: z.array(ClusterValidatorDetailSchema),
  withdrawalAddresses: z.array(z.string()),
  // Aggregated stats
  totalBalance: z.string(),
  totalEffectiveBalance: z.string(),
});

export type ClusterDetail = z.infer<typeof ClusterDetailSchema>;

/**
 * Add validators response schema
 */
export const AddValidatorsResponseSchema = z.object({
  added: z.number(),
});

export type AddValidatorsResponse = z.infer<typeof AddValidatorsResponseSchema>;

/**
 * Cluster snapshot response schema — aggregated performance metrics
 */
export const ClusterSnapshotSchema = z.object({
  activeCount: z.number(),
  inactiveCount: z.number(),
  statusBreakdown: z.record(z.string(), z.number()),

  totalBalance: z.string(),
  totalEffectiveBalance: z.string(),

  attestationsTotal: z.number(),
  attestationsMissed: z.number(),

  performanceH: z.number().nullable(),
  performanceD: z.number().nullable(),
  performanceW: z.number().nullable(),
  performanceM: z.number().nullable(),

  apyH: z.number().nullable(),
  apyD: z.number().nullable(),
  apyW: z.number().nullable(),
  apyM: z.number().nullable(),

  consensusRewardH: z.string().nullable(),
  consensusRewardD: z.string().nullable(),
  consensusRewardW: z.string().nullable(),
  consensusRewardM: z.string().nullable(),

  missedRewardH: z.string().nullable(),
  missedRewardD: z.string().nullable(),
  missedRewardW: z.string().nullable(),
  missedRewardM: z.string().nullable(),

  executionRewardH: z.object({ wei: z.string(), token: z.string() }).nullable(),
  executionRewardD: z.object({ wei: z.string(), token: z.string() }).nullable(),
  executionRewardW: z.object({ wei: z.string(), token: z.string() }).nullable(),
  executionRewardM: z.object({ wei: z.string(), token: z.string() }).nullable(),

  tokenPrice: z.number(),
});

export type ClusterSnapshot = z.infer<typeof ClusterSnapshotSchema>;
