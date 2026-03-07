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
