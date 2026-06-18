import { session as createSession } from 'grammy';

import type { Middleware, SessionOptions } from 'grammy';
import type { Context, SessionData } from '@/src/bot/context.js';

type Options = Pick<SessionOptions<SessionData, Context>, 'getSessionKey' | 'storage'>;

export function session(options: Options): Middleware<Context> {
  return createSession({
    getSessionKey: options.getSessionKey,
    storage: options.storage,
    initial: () => ({}),
  });
}
