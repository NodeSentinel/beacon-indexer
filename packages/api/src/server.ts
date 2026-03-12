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
 * Create and configure the HTTP server with both oRPC handlers
 * - OpenAPIHandler: for traditional HTTP requests (Postman, curl, etc.) - routes: /*
 * - RPCHandler: for oRPC client (RPCLink) - routes: /rpc/*
 */
export function createHttpServer() {
  // Handler for traditional HTTP requests (OpenAPI/REST-like)
  const openApiHandler = new OpenAPIHandler(router, {
    plugins: [
      new CORSPlugin({
        origin: (origin) => (isOriginAllowed(origin) ? origin : null),
        credentials: true,
      }),
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
      new CORSPlugin({
        origin: (origin) => (isOriginAllowed(origin) ? origin : null),
        credentials: true,
      }),
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
    // Set CORS headers on every response (including 404s and errors)
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-telegram-init-data',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

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
