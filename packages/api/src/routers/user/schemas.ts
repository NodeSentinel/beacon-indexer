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
