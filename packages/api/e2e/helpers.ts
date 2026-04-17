import crypto from 'node:crypto';

/**
 * E2E test API token — must match API_TOKEN_SECRET env var.
 * Used to authenticate test requests that don't need a user in context.
 */
export const E2E_API_TOKEN = process.env.API_TOKEN_SECRET!;

/**
 * Test session UUID for anonymous user authentication.
 * The middleware will find-or-create a user from this session ID.
 */
export const E2E_SESSION_ID = '00000000-e2e0-4000-8000-000000000001';

/**
 * Returns headers with API key auth for endpoints that don't need a user context.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${E2E_API_TOKEN}`,
    ...extra,
  };
}

/**
 * Returns headers with anonymous session auth for endpoints that need a user context.
 * Sends ns-anonymous-id + Origin header so the middleware resolves the anonymous user.
 */
export function userAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'ns-anonymous-id': E2E_SESSION_ID,
    Origin: process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:3000',
    ...extra,
  };
}

/**
 * Returns headers with bot-signature auth for endpoints called by the telegram bot.
 * Uses the same HMAC format as the production bot client.
 */
export function botAuthHeaders(
  telegramId: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', token)
    .update(`${telegramId}:${timestamp}`)
    .digest('hex');

  return {
    'bot-signature': signature,
    'bot-user-id': telegramId,
    'bot-timestamp': timestamp,
    ...extra,
  };
}
