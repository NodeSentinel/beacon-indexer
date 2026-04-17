import { createServer } from 'node:http';

import { OpenAPIHandler } from '@orpc/openapi/node';
import { RPCHandler } from '@orpc/server/node';
import { CORSPlugin } from '@orpc/server/plugins';

import { isOriginAllowed } from './auth/origin.js';
import { AuthStrategy } from './auth/types.js';
import { logger } from './lib/logger.js';
import { router } from './routers/index.js';

/**
 * CORS plugin — allows cross-origin requests from approved origins.
 * Auth strategy (Telegram, API key, anonymous) is handled separately
 * by the procedure middleware — CORS headers must always be present
 * for browser-based requests (including Telegram Mini App WebViews).
 */
const corsPlugin = new CORSPlugin({
  origin: (origin) => (isOriginAllowed(origin) ? origin : null),
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'x-telegram-init-data',
    'ns-anonymous-id',
    'bot-signature',
    'bot-user-id',
    'bot-timestamp',
  ],
  credentials: true,
});

type RequestLogMeta = {
  auth: string;
  origin?: string;
  rpcMethod?: string;
};

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function inferAuthStrategy(headers: Record<string, string | string[] | undefined>): string {
  if (getHeader(headers, 'x-telegram-init-data')) {
    return AuthStrategy.TELEGRAM;
  }

  if (
    getHeader(headers, 'bot-signature') &&
    getHeader(headers, 'bot-user-id') &&
    getHeader(headers, 'bot-timestamp')
  ) {
    return AuthStrategy.BOT_SIGNATURE;
  }

  if (getHeader(headers, 'authorization')) {
    return AuthStrategy.API_KEY;
  }

  if (getHeader(headers, 'ns-anonymous-id')) {
    return AuthStrategy.ANONYMOUS;
  }

  return 'unknown';
}

function getRpcMethod(pathname: string): string | undefined {
  if (!pathname.startsWith('/rpc/')) {
    return undefined;
  }

  return pathname.slice('/rpc/'.length).replaceAll('/', '.');
}

function buildRequestLogPrefix(method: string, pathname: string, meta: RequestLogMeta): string {
  const parts = [method, pathname];

  if (meta.rpcMethod) {
    parts.push(`rpc=${meta.rpcMethod}`);
  }

  parts.push(`auth=${meta.auth}`);

  if (meta.origin) {
    parts.push(`origin=${meta.origin}`);
  }

  return parts.join(' ');
}

/**
 * Create and configure the HTTP server with both oRPC handlers
 * - OpenAPIHandler: for traditional HTTP requests (Postman, curl, etc.) - routes: /*
 * - RPCHandler: for oRPC client (RPCLink) - routes: /rpc/*
 */
export function createHttpServer() {
  // Handler for traditional HTTP requests (OpenAPI/REST-like)
  const openApiHandler = new OpenAPIHandler(router, {
    plugins: [corsPlugin],
  });

  // Handler for oRPC client (RPCLink)
  const rpcHandler = new RPCHandler(router, {
    plugins: [corsPlugin],
  });

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    let requestPrefix = `${req.method ?? 'UNKNOWN'} ${req.url ?? 'UNKNOWN'}`;

    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method ?? 'UNKNOWN';
      const meta: RequestLogMeta = {
        auth: inferAuthStrategy(req.headers),
        origin: req.headers.origin,
        rpcMethod: getRpcMethod(pathname),
      };
      requestPrefix = buildRequestLogPrefix(method, pathname, meta);

      // Determine which handler to use based on path prefix
      // Routes starting with /rpc use RPCHandler (for oRPC client)
      // All other routes use OpenAPIHandler (for traditional HTTP)
      const isRPC = pathname.startsWith('/rpc');
      const handler = isRPC ? rpcHandler : openApiHandler;

      const result = await handler.handle(req, res, {
        prefix: isRPC ? '/rpc' : undefined,
        context: {
          headers: req.headers,
          logger,
        },
      });

      if (!result.matched) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('No procedure matched');
        logger.warn(`${requestPrefix} status=404 duration=${Date.now() - startedAt}ms`);
        return;
      }

      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;

      if (status >= 400) {
        const details = [`status=${status}`, `duration=${durationMs}ms`].join(' ');
        const logMethod = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
        logMethod(`${requestPrefix} ${details}`);
        return;
      }

      if (method === 'OPTIONS') {
        logger.debug(`${requestPrefix} status=${status} duration=${durationMs}ms`);
        return;
      }

      logger.info(`${requestPrefix} status=${status} duration=${durationMs}ms`);
    } catch (error) {
      logger.error({ err: error }, `${requestPrefix} Unhandled server error`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal server error');
      }
    }
  });

  return server;
}
