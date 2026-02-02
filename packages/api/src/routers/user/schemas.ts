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
