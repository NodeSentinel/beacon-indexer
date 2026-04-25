/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORPCError } from '@orpc/server';

import { UserResponseSchema } from './schemas.js';

import { ApiResponseSchema } from '@/utils/response.js';

/**
 * Creates the current-user route.
 */
export function createMeRoute(params: { procedures: { securedProcedure: any } }) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/users/me' })
    .output(ApiResponseSchema(UserResponseSchema))
    .handler(async ({ context }: any) => {
      if (!context.user) {
        throw new ORPCError('UNAUTHORIZED', {
          message: 'No user in context',
        });
      }

      return {
        success: true,
        data: {
          id: context.user.id,
          username: context.user.username,
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
}
