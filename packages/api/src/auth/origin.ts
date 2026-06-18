import type { Logger } from '@/lib/logger.js';

export interface OriginCheckConfig {
  allowedOrigins: string;
  logger: Logger;
}

/**
 * Returns true when the origin is allowed by config.
 */
export function isOriginAllowed(origin: string | undefined, config: OriginCheckConfig): boolean {
  const patterns = config.allowedOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  /**
   * Checks whether one origin matches a configured pattern.
   */
  function matchesPattern(origin: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }

    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-zA-Z0-9-]+');
      return new RegExp(`^${escaped}$`).test(origin);
    }

    return origin === pattern;
  }

  if (!origin) {
    config.logger.debug({ origin }, 'CORS: no origin header');
    return false;
  }

  const allowed = patterns.some((pattern) => matchesPattern(origin, pattern));
  config.logger.debug({ origin, patterns, allowed }, 'CORS: origin check');
  return allowed;
}
