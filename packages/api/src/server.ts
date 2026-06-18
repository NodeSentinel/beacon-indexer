import { createServer } from 'node:http';

import { OpenAPIHandler } from '@orpc/openapi/node';
import { RPCHandler } from '@orpc/server/node';
import { CORSPlugin } from '@orpc/server/plugins';

import { isOriginAllowed } from './auth/origin.js';
import type { Logger } from './lib/logger.js';
import {
  buildRequestLogPrefix,
  getRpcMethod,
  inferAuthStrategy,
  type RequestLogMeta,
} from './lib/request-logging.js';
import type { createRouter } from './routers/index.js';

/**
 * Creates the HTTP server from explicit runtime dependencies.
 */
export function createHttpServer(params: {
  allowedOrigins: string;
  logger: Logger;
  router: ReturnType<typeof createRouter>;
}) {
  const corsPlugin = new CORSPlugin({
    origin: (origin) =>
      isOriginAllowed(origin, {
        allowedOrigins: params.allowedOrigins,
        logger: params.logger,
      })
        ? origin
        : null,
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

  const openApiHandler = new OpenAPIHandler(params.router, {
    plugins: [corsPlugin],
  });
  const rpcHandler = new RPCHandler(params.router, {
    plugins: [corsPlugin],
  });

  return createServer(async (req, res) => {
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

      const isRPC = pathname.startsWith('/rpc');
      const handler = isRPC ? rpcHandler : openApiHandler;

      const result = await handler.handle(req, res, {
        prefix: isRPC ? '/rpc' : undefined,
        context: {
          headers: req.headers,
          logger: params.logger,
        },
      });

      if (!result.matched) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('No procedure matched');
        params.logger.warn(`${requestPrefix} status=404 duration=${Date.now() - startedAt}ms`);
        return;
      }

      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;

      if (status >= 400) {
        const details = [`status=${status}`, `duration=${durationMs}ms`].join(' ');
        const logMethod =
          status >= 500
            ? params.logger.error.bind(params.logger)
            : params.logger.warn.bind(params.logger);
        logMethod(`${requestPrefix} ${details}`);
        return;
      }

      if (method === 'OPTIONS') {
        params.logger.debug(`${requestPrefix} status=${status} duration=${durationMs}ms`);
        return;
      }

      params.logger.info(`${requestPrefix} status=${status} duration=${durationMs}ms`);
    } catch (error) {
      params.logger.error({ err: error }, `${requestPrefix} Unhandled server error`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal server error');
      }
    }
  });
}
