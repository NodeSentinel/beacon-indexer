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
  validatorIndexes: z.array(z.number().int().nonnegative()).min(1),
  lidoCsmOperatorId: z.number().int().nonnegative().optional(),
});

export type CreateClusterInput = z.infer<typeof CreateClusterInputSchema>;

/**
 * Cluster ID path parameter schema
 */
export const ClusterIdParamSchema = z.object({
  id: z.string(),
});

export type ClusterIdParam = z.infer<typeof ClusterIdParamSchema>;

/**
 * Input for clearing the current cluster's Lido CSM operator.
 */
export const ClearLidoCsmOperatorInputSchema = ClusterIdParamSchema;

export type ClearLidoCsmOperatorInput = z.infer<typeof ClearLidoCsmOperatorInputSchema>;

/**
 * Shared pagination schema for cluster incident listings.
 */
export const ClusterIncidentPaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

export type ClusterIncidentPagination = z.infer<typeof ClusterIncidentPaginationSchema>;

/**
 * Incident ID path parameter schema.
 */
export const ClusterIncidentIdParamSchema = z.object({
  incidentId: z.string().uuid(),
});

export type ClusterIncidentIdParam = z.infer<typeof ClusterIncidentIdParamSchema>;

/**
 * List incidents input schema.
 */
export const ClusterIncidentsInputSchema = ClusterIdParamSchema.extend(
  ClusterIncidentPaginationSchema.shape,
);

export type ClusterIncidentsInput = z.infer<typeof ClusterIncidentsInputSchema>;

/**
 * Cluster incident response item schema.
 */
export const ClusterIncidentSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']),
  openedAt: z.string(),
  openedSlot: z.number(),
  closedAt: z.string().nullable(),
  closedSlot: z.number().nullable(),
  durationSlots: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  missedAttestationRewards: z.string().nullable(),
  missedSyncRewards: z.string().nullable(),
  missedConsensusRewards: z.string().nullable(),
  rewardsFinalized: z.boolean(),
  rewardsFinalizedAt: z.string().nullable(),
  openedNotificationQueuedAt: z.string().nullable(),
  closedNotificationQueuedAt: z.string().nullable(),
});

export type ClusterIncident = z.infer<typeof ClusterIncidentSchema>;

/**
 * Paginated cluster incidents response schema.
 */
export const ClusterIncidentsResponseSchema = z.object({
  incidents: z.array(ClusterIncidentSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type ClusterIncidentsResponse = z.infer<typeof ClusterIncidentsResponseSchema>;

/**
 * Incident notification update response schema.
 */
export const ClusterIncidentNotificationSchema = z.object({
  incidentId: z.string(),
  notifiedAt: z.string(),
});

export type ClusterIncidentNotification = z.infer<typeof ClusterIncidentNotificationSchema>;

/**
 * Affected validators list input schema.
 */
export const ClusterIncidentAffectedValidatorsInputSchema = ClusterIncidentIdParamSchema.extend(
  ClusterIncidentPaginationSchema.shape,
);

export type ClusterIncidentAffectedValidatorsInput = z.infer<
  typeof ClusterIncidentAffectedValidatorsInputSchema
>;

/**
 * Affected validator response item schema.
 */
export const ClusterIncidentAffectedValidatorSchema = z.object({
  validatorIndex: z.number(),
  inactiveFromSlot: z.number(),
  inactiveToSlot: z.number().nullable(),
  rewardsProcessedThroughSlot: z.number().nullable(),
  missedAttestationRewards: z.string(),
  missedSyncRewards: z.string(),
  missedConsensusRewards: z.string(),
});

export type ClusterIncidentAffectedValidator = z.infer<
  typeof ClusterIncidentAffectedValidatorSchema
>;

/**
 * Paginated affected validators response schema.
 */
export const ClusterIncidentAffectedValidatorsResponseSchema = z.object({
  validators: z.array(ClusterIncidentAffectedValidatorSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type ClusterIncidentAffectedValidatorsResponse = z.infer<
  typeof ClusterIncidentAffectedValidatorsResponseSchema
>;

/**
 * Update cluster input schema
 */
export const UpdateClusterInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  visibility: ClusterVisibilitySchema.optional(),
  feeRecipientAddress: ethereumAddressSchema.nullable().optional(),
  validatorIndexes: z.array(z.number().int().nonnegative()).optional(),
  lidoCsmOperatorId: z.number().int().nonnegative().optional(),
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
  lidoOperatorId: z.string().nullable(),
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
 * Cluster summary item with validator count for cross-user reporting.
 */
export const ClusterSummaryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerUsername: z.string(),
  validatorCount: z.number(),
  tokenAmount: z.string(),
});

/**
 * Count and validator totals for one user category in the summary response.
 */
export const ClusterSummaryMetricSchema = z.object({
  total: z.number(),
  totalUniqueValidators: z.number(),
  tokenAmount: z.string(),
});

/**
 * Active user totals plus category breakdowns that may overlap by design.
 */
export const ActiveUsersSummarySchema = ClusterSummaryMetricSchema.extend({
  details: z.object({
    telegram: ClusterSummaryMetricSchema,
    lido: ClusterSummaryMetricSchema,
    annon: ClusterSummaryMetricSchema,
  }),
});

/**
 * Counts users with no cluster that currently has loaded validators.
 */
export const InactiveUsersSummarySchema = z.object({
  total: z.number(),
  annon: z.number(),
  tg: z.number(),
});

/**
 * Cross-user cluster summary response schema.
 */
export const ClusterSummarySchema = z.object({
  totalClusters: z.number(),
  activeUsers: ActiveUsersSummarySchema,
  tgBlockedUsers: ClusterSummaryMetricSchema,
  inactiveUsers: InactiveUsersSummarySchema,
  clusters: z.array(ClusterSummaryItemSchema),
});

export type ClusterSummary = z.infer<typeof ClusterSummarySchema>;

/**
 * Response for clearing the current cluster's Lido CSM operator from one cluster.
 */
export const ClearLidoCsmOperatorResponseSchema = z.object({
  id: z.string(),
  lidoOperatorId: z.string().nullable(),
  removedValidatorIndexes: z.array(z.number().int().nonnegative()),
});

export type ClearLidoCsmOperatorResponse = z.infer<typeof ClearLidoCsmOperatorResponseSchema>;

/**
 * Cluster validator detail schema
 */
export const ClusterValidatorDetailSchema = z.object({
  validatorIndex: z.number(),
  withdrawalAddress: z.string().nullable(),
  status: z.number().nullable(),
  isInactive: z.boolean(),
  performanceH: z.number().nullable(),
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

  attestationEfficiencyD: z.number().nullable(),
  attestationEfficiencyW: z.number().nullable(),
  attestationEfficiencyM: z.number().nullable(),

  avgAttestationDelayD: z.number().nullable(),
  avgAttestationDelayW: z.number().nullable(),
  avgAttestationDelayM: z.number().nullable(),

  claimableRewards: z.string().nullable(),
  tokenPrice: z.number(),
});

export type ClusterSnapshot = z.infer<typeof ClusterSnapshotSchema>;
