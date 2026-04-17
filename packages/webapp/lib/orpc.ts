'use client';

import type { router } from '@beacon-indexer/api/routers';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import { env } from '@/env';
import { getAuthSnapshot } from '@/lib/auth-session';

export type AppRouter = RouterClient<typeof router>;

// Create RPC link pointing to the API server
const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_API_URL}/rpc`,
  headers: () => {
    const auth = getAuthSnapshot();

    if (auth.telegramInitData) {
      return { 'x-telegram-init-data': auth.telegramInitData };
    }

    if (auth.anonymousSessionId) {
      return { 'ns-anonymous-id': auth.anonymousSessionId };
    }

    return {};
  },
});

// Create oRPC client
export const orpcClient: AppRouter = createORPCClient(link);

// Create TanStack Query utils for React
export const orpc = createTanstackQueryUtils(orpcClient);
