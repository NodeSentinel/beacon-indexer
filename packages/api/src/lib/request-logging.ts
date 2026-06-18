import { AuthStrategy } from '@/auth/types.js';

export type RequestLogMeta = {
  auth: string;
  origin?: string;
  rpcMethod?: string;
};

/**
 * Gets a single header value from a Node request header map.
 */
function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Infers the auth strategy from the incoming request headers.
 */
export function inferAuthStrategy(headers: Record<string, string | string[] | undefined>): string {
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

/**
 * Maps an RPC pathname to the dot-separated RPC method name.
 */
export function getRpcMethod(pathname: string): string | undefined {
  if (!pathname.startsWith('/rpc/')) {
    return undefined;
  }

  return pathname.slice('/rpc/'.length).replaceAll('/', '.');
}

/**
 * Builds the compact request prefix used by the server logs.
 */
export function buildRequestLogPrefix(
  method: string,
  pathname: string,
  meta: RequestLogMeta,
): string {
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
