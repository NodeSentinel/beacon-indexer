import { z } from 'zod';

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
  feeRecipientAddress: z.string().max(42).nullable().optional(),
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
  feeRecipientAddress: z.string().max(42).nullable().optional(),
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
 * Remove validators by withdrawal address input schema
 */
export const RemoveValidatorsByAddressInputSchema = z.object({
  withdrawalAddress: z.string().length(42),
});

export type RemoveValidatorsByAddressInput = z.infer<typeof RemoveValidatorsByAddressInputSchema>;

/**
 * Remove validators by address response schema
 */
export const RemoveValidatorsByAddressResponseSchema = z.object({
  removed: z.number(),
});

/**
 * Remove validator path parameters schema
 */
export const RemoveValidatorParamSchema = z.object({
  id: z.string(),
  validatorIndex: z.coerce.number().int().nonnegative(),
});

export type RemoveValidatorParam = z.infer<typeof RemoveValidatorParamSchema>;

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
 * Cluster detail schema (for get endpoint) - includes validators and derived withdrawalAddresses
 */
export const ClusterDetailSchema = ClusterSchema.extend({
  validators: z.array(z.object({ validatorIndex: z.number() })),
  withdrawalAddresses: z.array(z.string()),
});

export type ClusterDetail = z.infer<typeof ClusterDetailSchema>;

/**
 * Add validators response schema
 */
export const AddValidatorsResponseSchema = z.object({
  added: z.number(),
});

export type AddValidatorsResponse = z.infer<typeof AddValidatorsResponseSchema>;
