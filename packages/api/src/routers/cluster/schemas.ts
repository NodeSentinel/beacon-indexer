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
 * Add validators input schema
 */
export const AddValidatorsInputSchema = z.object({
  validatorIndexes: z.array(z.number().int().nonnegative()).min(1),
});

export type AddValidatorsInput = z.infer<typeof AddValidatorsInputSchema>;

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
