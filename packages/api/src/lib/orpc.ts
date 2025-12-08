import { os } from '@orpc/server';

/**
 * Base oRPC instance with logger and headers in context
 * Logger and headers will be provided via context when calling handler.handle()
 * Use this for public procedures that don't require authentication
 */
export const publicProcedure = os.$context<{
  logger: typeof import('./logger.js').logger;
  headers: Record<string, string | string[] | undefined>;
}>();

/**
 * Base instance with logger and headers in context
 * Logger and headers will be provided via context when calling handler.handle()
 */
export const baseProcedure = os.$context<{
  logger: typeof import('./logger.js').logger;
  headers: Record<string, string | string[] | undefined>;
}>();
