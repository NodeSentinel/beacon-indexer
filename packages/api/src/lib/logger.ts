import pino from 'pino';

export type Logger = pino.Logger;

/**
 * Creates the API logger from plain parameters.
 */
export function createLogger(params: {
  logLevel: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  nodeEnv: 'development' | 'production' | 'test';
}): Logger {
  return pino({
    level: params.logLevel,
    transport:
      params.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  });
}
