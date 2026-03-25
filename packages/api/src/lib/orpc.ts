import { os } from '@orpc/server';

export interface DbUser {
  id: bigint;
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
 * Public procedure — no auth required.
 * Used only for health check and infrastructure endpoints.
 */
export const publicProcedure = os.$context<BaseContext>();

/**
 * Base instance for building authenticated procedure chains.
 */
export const baseProcedure = os.$context<BaseContext>();
