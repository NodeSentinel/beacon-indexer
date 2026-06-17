import { z } from 'zod';

/**
 * Anonymous user registration input
 */
export const AnonymousUserInputSchema = z.object({
  sessionId: z.string().uuid(),
});

export type AnonymousUserInput = z.infer<typeof AnonymousUserInputSchema>;

/**
 * User response schema
 */
export const UserResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;

/**
 * Response returned after a successful Telegram user claim transaction.
 */
export const ClaimUserResponseSchema = z.object({
  claimedAddresses: z.array(z.string()),
  nextClaimAt: z.string(),
  transactionHash: z.string(),
  transactionUrl: z.string(),
});

export type ClaimUserResponse = z.infer<typeof ClaimUserResponseSchema>;

/**
 * User ID path parameter schema for API-key user inspection routes.
 */
export const UserIdParamSchema = z.object({
  userId: z.string().min(1),
});

export type UserIdParam = z.infer<typeof UserIdParamSchema>;

/**
 * Validator fields exposed when listing a user's clusters through an API token.
 */
export const UserClusterValidatorSchema = z.object({
  validatorIndex: z.number(),
  withdrawalAddress: z.string().nullable(),
  status: z.number().nullable(),
  balance: z.string(),
  effectiveBalance: z.string().nullable(),
  pubkey: z.string().nullable(),
});

export type UserClusterValidator = z.infer<typeof UserClusterValidatorSchema>;

/**
 * Cluster plus nested validators for API-token user inspection.
 */
export const UserClusterWithValidatorsSchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: z.enum(['private', 'shared']),
  feeRecipientAddress: z.string().nullable(),
  lidoOperatorId: z.string().nullable(),
  ownerId: z.string(),
  createdAt: z.string(),
  validators: z.array(UserClusterValidatorSchema),
});

export type UserClusterWithValidators = z.infer<typeof UserClusterWithValidatorsSchema>;
