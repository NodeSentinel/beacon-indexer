import type { router } from '@beacon-indexer/api/routers';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

import type { RouterClient } from '@orpc/server';

import { createBotSignatureHeaders } from '@/src/api/sign.js';
import { env } from '@/src/env.js';

export type AppRouter = RouterClient<typeof router>;

/** Synthetic telegram id used for bot requests not tied to a specific user. */
export const COMMON_REQUESTS_TELEGRAM_ID = '0';

/**
 * Creates an RPC client whose auth headers are bound to a specific telegramId.
 * Each caller gets its own client instance, so requests never share mutable auth state.
 */
export function getRpcClientForUser(telegramId: string): AppRouter {
  const link = new RPCLink({
    url: `${env.API_URL}/rpc`,
    headers: () => createBotSignatureHeaders(env.BOT_TOKEN, telegramId),
  });

  return createORPCClient(link);
}
