import { ORPCError } from '@orpc/server';

import { UserResponseSchema } from './schemas.js';

import { telegramAuthProcedure } from '@/auth/middleware.js';
import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Get the current authenticated Telegram user
 * GET /users/me
 *
 * Requires Telegram initData — returns the DB user resolved by the middleware.
 */
export const me = telegramAuthProcedure
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
