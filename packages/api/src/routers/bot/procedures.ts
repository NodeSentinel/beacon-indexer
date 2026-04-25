/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORPCError } from '@orpc/server';

import type { ApiProcedures } from '@/auth/middleware.js';
import { AuthStrategy } from '@/auth/types.js';

/**
 * Builds the bot-specific secured procedure.
 */
export function createBotProcedure(procedures: ApiProcedures) {
  return procedures.securedProcedure.use(async ({ context, next }: any) => {
    if (context.authStrategy !== AuthStrategy.BOT_SIGNATURE) {
      throw new ORPCError('FORBIDDEN', {
        message: 'This endpoint requires bot-signature authentication',
      });
    }

    return next({ context });
  });
}
