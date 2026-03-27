import { os } from '@orpc/server';

export interface DbUser {
  id: string;
  username: string;
}

/**
 * Base context shape for all procedures.
 * `user` is populated by auth middleware when Telegram auth succeeds.
 */
export interface BaseContext {
  logger: typeof import('./logger.js').logger;
  headers: Record<string, string | string[] | undefined>;
  user?: DbUser;
}

/**
 * Base instance for building procedure chains (public and authenticated).
 */
export const baseProcedure = os.$context<BaseContext>();

/**
 * Public procedure alias — used directly for endpoints with no auth (e.g. health check).
 */
export const publicProcedure = baseProcedure;
