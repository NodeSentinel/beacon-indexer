import { AnonymousUserInputSchema, UserResponseSchema } from './schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
import { UserStorage } from '@/storage/user.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Get or create an anonymous user
 * POST /users/anonymous
 *
 * This allows the frontend to work without login.
 * The sessionId (UUID from localStorage) is used to identify the user.
 * In the future, this anonymous user can be linked to a real account.
 */
export const anonymousUser = securedProcedure
  .route({ method: 'POST', path: '/users/anonymous' })
  .input(AnonymousUserInputSchema)
  .output(ApiResponseSchema(UserResponseSchema))
  .handler(async ({ input }) => {
    try {
      const storage = new UserStorage();
      const user = await storage.getOrCreateAnonymous(input.sessionId);

      return {
        success: true,
        data: {
          id: user.id.toString(),
          username: user.username,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create anonymous user';
      return {
        success: false,
        error: { code: 'USER_ANONYMOUS_ERROR', message },
        meta: { timestamp: new Date().toISOString() },
      };
    }
  });
