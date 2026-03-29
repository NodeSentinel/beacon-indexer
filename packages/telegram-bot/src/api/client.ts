import type { router } from '@beacon-indexer/api/routers';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';

import { createBotSignatureHeaders } from '@/src/api/sign.js';
import { env } from '@/src/env.js';

export type AppRouter = RouterClient<typeof router>;

/**
 * Module-level variable for the current telegramId.
 * Set before each API call in the scheduler loop.
 * Since the scheduler processes users sequentially, this is safe.
 */
let currentTelegramId = '';

/**
 * Set the telegramId for the next API request(s).
 * Must be called before using the orpcClient for a specific user.
 */
export function setCurrentTelegramId(telegramId: string): void {
  currentTelegramId = telegramId;
}

const link = new RPCLink({
  url: `${env.API_URL}/rpc`,
  headers: () => {
    if (!currentTelegramId) {
      throw new Error('currentTelegramId not set — call setCurrentTelegramId() first');
    }
    return createBotSignatureHeaders(env.BOT_TOKEN, currentTelegramId);
  },
});

export const orpcClient: AppRouter = createORPCClient(link);
