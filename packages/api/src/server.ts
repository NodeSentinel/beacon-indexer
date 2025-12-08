import { createServer } from 'node:http';

import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import { CORSPlugin } from '@orpc/server/plugins';

import { logger } from './lib/logger.js';
import { router } from './routers/index.js';

/**
 * Create and configure the HTTP server with oRPC handler
 */
export function createHttpServer() {
  const rpcHandler = new RPCHandler(router, {
    plugins: [new CORSPlugin()],
    interceptors: [
      onError((error) => {
        logger.error({ err: error }, 'oRPC error');
      }),
    ],
  });

  const server = createServer(async (req, res) => {
    try {
      const result = await rpcHandler.handle(req, res, {
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
