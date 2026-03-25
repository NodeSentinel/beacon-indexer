import { ORPCError } from '@orpc/server';

import { UserResponseSchema } from './schemas.js';

import { securedProcedure } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Get the current authenticated user
 * GET /users/me
 *
 * Works for both Telegram and anonymous users — returns the DB user
 * resolved by the middleware. Returns 401 if no user in context (API key auth).
 */
export const me = securedProcedure
  .route({ method: 'GET', path: '/users/me' })
  .output(ApiResponseSchema(UserResponseSchema))
  .handler(async ({ context }) => {
    if (!context.user) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'No user in context',
      });
    }

    return {
      success: true,
      data: {
        id: context.user.id.toString(),
        username: context.user.username,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  });
