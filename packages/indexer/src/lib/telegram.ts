import { env } from '@/src/lib/env.js';
import createLogger from '@/src/lib/pino.js';

const logger = createLogger('TelegramAlerts');

export async function sendTelegramAlert(message: string): Promise<void> {
  const token = env.TELEGRAM_ALERTS_BOT_TOKEN;
  const chatId = env.TELEGRAM_ALERTS_CHAT_ID;

  if (!token || !chatId) {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(`Telegram API error (${response.status}): ${body}`, new Error(body));
    }
  } catch (error) {
    logger.error('Failed to send Telegram alert', error);
  }
}
