import crypto from 'node:crypto';
import { createServer } from 'node:http';

import { LoggingHandlerPlugin } from '@orpc/experimental-pino';
import { OpenAPIHandler } from '@orpc/openapi/node';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import { CORSPlugin } from '@orpc/server/plugins';

import { isOriginAllowed } from './auth/origin.js';
import { logger } from './lib/logger.js';
import { router } from './routers/index.js';

/**
 * CORS plugin — only applies to origin-based (anonymous web) requests.
 * Telegram and API key requests are authenticated by their credentials,
 * not by origin, and must not have CORS headers injected.
 */
const corsPlugin = new CORSPlugin({
  origin: (origin, options) => {
    const reqHeaders = options.request.headers;
    // Skip CORS for Telegram and API key authenticated requests
    if (reqHeaders['x-telegram-init-data'] || reqHeaders.authorization) {
      return null;
    }
    return isOriginAllowed(origin) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'x-telegram-init-data', 'ns-anonymous-id'],
  credentials: true,
});

/**
 * Create and configure the HTTP server with both oRPC handlers
 * - OpenAPIHandler: for traditional HTTP requests (Postman, curl, etc.) - routes: /*
 * - RPCHandler: for oRPC client (RPCLink) - routes: /rpc/*
 */
export function createHttpServer() {
  // Handler for traditional HTTP requests (OpenAPI/REST-like)
  const openApiHandler = new OpenAPIHandler(router, {
    plugins: [
      corsPlugin,
      new LoggingHandlerPlugin({
        logger,
        generateId: () => crypto.randomUUID(),
        logRequestResponse: true,
        logRequestAbort: true,
      }) as any,
    ],
    interceptors: [
      onError((error) => {
        logger.error(
          {
            err: error,
            errorCode: (error as any)?.code,
            errorMessage: (error as any)?.message,
            errorData: (error as any)?.data,
          },
          'OpenAPI handler error',
        );
      }),
    ],
  });

  // Handler for oRPC client (RPCLink)
  const rpcHandler = new RPCHandler(router, {
    plugins: [
      corsPlugin,
      new LoggingHandlerPlugin({
        logger,
        generateId: () => crypto.randomUUID(),
        logRequestResponse: true,
        logRequestAbort: true,
      }) as any,
    ],
    interceptors: [
      onError((error) => {
        logger.error(
          {
            err: error,
            errorCode: (error as any)?.code,
            errorMessage: (error as any)?.message,
            errorData: (error as any)?.data,
          },
          'RPC handler error',
        );
      }),
    ],
  });

  const server = createServer(async (req, res) => {
    logger.info(
      { method: req.method, url: req.url, origin: req.headers.origin },
      'Incoming request',
    );

    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const pathname = url.pathname;

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

      logger.info({ matched: result.matched, responseHeaders: res.getHeaders() }, 'Handler result');

      if (!result.matched) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('No procedure matched');
      }
    } catch (error) {
      logger.error({ err: error }, 'Server error');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal server error');
      }
    }
  });

  return server;
}
