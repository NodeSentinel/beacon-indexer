import { z } from 'zod';

export const MissedAttestationsInputSchema = z.object({
  id: z.string(),
  range: z.enum(['1h', '24h']).default('1h'),
});

export const MissedAttestationsAllInputSchema = z.object({
  ownerId: z.string(),
  range: z.enum(['1h', '24h']).default('1h'),
});

export const MissedAttestationsValidatorInputSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
  range: z.enum(['1h', '24h']).default('1h'),
});

export const MissedAttestationItemSchema = z.object({
  timestamp: z.string(),
  count: z.number(),
  validatorCount: z.number(),
});

export const MissedAttestationsResponseSchema = z.array(MissedAttestationItemSchema);

// ── Shared analytics input schemas ──────────────────────────────────────────

export const AnalyticsRangeSchema = z.enum(['1h', '24h']).default('1h');

export const AnalyticsClusterInputSchema = z.object({
  id: z.string(),
  range: AnalyticsRangeSchema,
});

export const AnalyticsAllClustersInputSchema = z.object({
  ownerId: z.string(),
  range: AnalyticsRangeSchema,
});

export const AnalyticsValidatorInputSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
  range: AnalyticsRangeSchema,
});

// ── Rewards schemas ─────────────────────────────────────────────────────────

export const RewardItemSchema = z.object({
  timestamp: z.string(),
  /** CL attestation rewards — head, target, source, inactivity (in token: GNO or ETH) */
  head: z.string(),
  target: z.string(),
  source: z.string(),
  inactivity: z.string(),
  /** Sync committee rewards (in token: GNO or ETH) */
  syncCommittee: z.string(),
  /** Sum of missed CL rewards (in token: GNO or ETH) */
  missed: z.string(),
  /** Block proposal consensus reward (in token: GNO or ETH) */
  blockConsensus: z.string(),
  /** Block proposal execution reward (in native EL token: xDAI or ETH) */
  blockExecution: z.string(),
});

export const RewardsResponseSchema = z.object({
  items: z.array(RewardItemSchema),
  tokenPrice: z.number(),
});
