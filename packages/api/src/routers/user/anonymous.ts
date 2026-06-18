/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnonymousUserInputSchema, UserResponseSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the anonymous user route.
 */
export function createAnonymousUserRoute(params: {
  procedures: ApiProcedures;
  userStorage: {
    getOrCreateAnonymous: (sessionId: string) => Promise<{ id: string; username: string }>;
  };
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'POST', path: '/users/anonymous' })
    .input(AnonymousUserInputSchema)
    .output(ApiResponseSchema(UserResponseSchema))
    .handler(async ({ input }: any) => {
      try {
        const user = await params.userStorage.getOrCreateAnonymous(input.sessionId);

        return {
          success: true,
          data: {
            id: user.id,
            username: user.username,
          },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'USER_ANONYMOUS_ERROR',
            message: error instanceof Error ? error.message : 'Failed to create anonymous user',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
