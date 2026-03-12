import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

/**
 * Parse ALLOWED_ORIGINS env var into an array of patterns.
 */
function parseAllowedOrigins(): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Check if an origin matches a pattern.
 * Supports:
 *  - "*" (allow all)
 *  - "https://*.example.com" (wildcard subdomain)
 *  - "http://localhost:3000" (exact match)
 */
function matchesPattern(origin: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-zA-Z0-9-]+');
    return new RegExp(`^${escaped}$`).test(origin);
  }

  return origin === pattern;
}

/**
 * Returns true if the given origin is in the allowed list.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    logger.debug({ origin }, 'CORS: no origin header');
    return false;
  }

  const patterns = parseAllowedOrigins();
  const allowed = patterns.some((pattern) => matchesPattern(origin, pattern));
  logger.info({ origin, patterns, allowed }, 'CORS: origin check');
  return allowed;
}
