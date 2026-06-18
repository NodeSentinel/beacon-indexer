import type { Context } from '@/src/bot/context.js';

export function isAdmin(ctx: Context) {
  return !!ctx.from && ctx.config.botAdmins.includes(ctx.from.id);
}
