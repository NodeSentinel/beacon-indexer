import crypto from 'node:crypto';

import { ORPCError } from '@orpc/server';

import { env } from '@/config/env.js';

/** Maximum age of bot-signature before it's considered expired */
const BOT_SIGNATURE_MAX_AGE_SECONDS = 60;

/**
 * Bot-signature authentication strategy.
 * Validates HMAC-SHA256 signature created by the telegram bot using BOT_TOKEN.
 *
 * Headers:
 *   bot-signature: HMAC-SHA256(BOT_TOKEN, telegramId + ":" + timestamp)
 *   bot-user-id: telegram user ID (string)
 *   bot-timestamp: unix timestamp in seconds (string)
 */
export function authenticateBotSignature(
  signature: string,
  telegramId: string,
  timestamp: string,
): void {
  // Verify timestamp freshness
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);

  if (Number.isNaN(ts) || Math.abs(now - ts) > BOT_SIGNATURE_MAX_AGE_SECONDS) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Bot signature expired or invalid timestamp',
    });
  }

  // Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', env.TELEGRAM_BOT_TOKEN)
    .update(`${telegramId}:${timestamp}`)
    .digest('hex');

  // Timing-safe comparison
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Invalid bot signature',
    });
  }
}
