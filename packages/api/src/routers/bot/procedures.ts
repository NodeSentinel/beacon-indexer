import { ORPCError } from '@orpc/server';

import { AuthStrategy } from '@/auth/types.js';
import { securedProcedure } from '@/lib/procedures.js';

export const botProcedure = securedProcedure.use(async ({ context, next }) => {
  if (context.authStrategy !== AuthStrategy.BOT_SIGNATURE) {
    throw new ORPCError('FORBIDDEN', {
      message: 'This endpoint requires bot-signature authentication',
    });
  }

  return next({ context });
});
