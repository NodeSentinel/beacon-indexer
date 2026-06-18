import crypto from 'node:crypto';

import { ORPCError } from '@orpc/server';

/** Maximum age of bot-signature before it's considered expired. */
const BOT_SIGNATURE_MAX_AGE_SECONDS = 60;

export interface BotSignatureAuthenticator {
  authenticateBotSignature: (signature: string, telegramId: string, timestamp: string) => void;
}

/**
 * Creates the bot-signature authentication strategy.
 */
export function createBotSignatureAuthenticator(
  telegramBotToken: string,
): BotSignatureAuthenticator {
  /**
   * Authenticates a bot-signature request.
   */
  function authenticateBotSignature(
    signature: string,
    telegramId: string,
    timestamp: string,
  ): void {
    const ts = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);

    if (Number.isNaN(ts) || Math.abs(now - ts) > BOT_SIGNATURE_MAX_AGE_SECONDS) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Bot signature expired or invalid timestamp',
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', telegramBotToken)
      .update(`${telegramId}:${timestamp}`)
      .digest('hex');

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

  return {
    authenticateBotSignature,
  };
}
