import crypto from 'node:crypto';

/**
 * Create bot-signature headers for API authentication.
 * Signs telegramId + timestamp with the bot token using HMAC-SHA256.
 */
export function createBotSignatureHeaders(
  botToken: string,
  telegramId: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', botToken)
    .update(`${telegramId}:${timestamp}`)
    .digest('hex');

  return {
    'bot-signature': signature,
    'bot-user-id': telegramId,
    'bot-timestamp': timestamp,
  };
}
