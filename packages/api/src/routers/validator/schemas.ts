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
  epochs: z.array(EpochSchema),
});

export type ValidatorDetails = z.infer<typeof ValidatorDetailsSchema>;
export type ValidatorInfo = z.infer<typeof ValidatorInfoSchema>;
export type Epoch = z.infer<typeof EpochSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Attestation = z.infer<typeof AttestationSchema>;
export type EpochRewards = z.infer<typeof EpochRewardsSchema>;

/**
 * Validator search input schema
 * Supports searching by: index, pubkey, or withdrawalAddress (single or multiple)
 * Exactly one type of parameter must be provided
 */
export const ValidatorSearchInputSchema = z
  .object({
    index: z.coerce.number().int().nonnegative().optional(),
    indexes: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((v) => parseInt(v.trim(), 10))
          .filter((n) => !isNaN(n)),
      )
      .optional(),
    pubkey: z.string().length(98).optional(),
    pubkeys: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      )
      .optional(),
    withdrawalAddress: z.string().length(42).optional(),
    withdrawalAddresses: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      )
      .optional(),
  })
  .refine(
    (data) => {
      const providedFields = [
        data.index,
        data.indexes,
        data.pubkey,
        data.pubkeys,
        data.withdrawalAddress,
        data.withdrawalAddresses,
      ].filter(
        (field) => field !== undefined && (Array.isArray(field) ? field.length > 0 : true),
      ).length;
      return providedFields === 1;
    },
    {
      message: 'Exactly one of indexe/s, pubkey/s or withdrawalAddress/es must be provided.',
    },
  );

export type ValidatorSearchInput = z.infer<typeof ValidatorSearchInputSchema>;

/**
 * Validator search result item schema
 */
export const ValidatorSearchResultSchema = z.object({
  index: z.number().int(),
  pubkey: z.string().nullable(),
  withdrawalAddress: z.string().nullable(),
});

export type ValidatorSearchResult = z.infer<typeof ValidatorSearchResultSchema>;

/**
 * Validator search response schema
 */
export const ValidatorSearchResponseSchema = z.object({
  validators: z.array(ValidatorSearchResultSchema),
});
