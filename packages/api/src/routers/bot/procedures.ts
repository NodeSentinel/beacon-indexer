import type { ApiProcedures } from '@/auth/middleware.js';

/**
 * Builds the bot-specific public procedure.
 */
export function createBotProcedure(procedures: ApiProcedures) {
  return procedures.publicProcedure;
}
