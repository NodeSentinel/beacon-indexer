import crypto from 'node:crypto';

import { ORPCError } from '@orpc/server';

import { AuthStrategy, type TelegramUser } from '../types.js';

import { env } from '@/config/env.js';

/**
 * Telegram Mini App authentication strategy
 * Validates initData from Telegram Web Apps
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function authenticateTelegram(initData: string): Promise<TelegramUser> {
  try {
    // Parse init data
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    if (!hash) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Missing hash in init data',
      });
    }

    // Create data check string
    const dataCheckArray: string[] = [];
    params.forEach((value, key) => {
      dataCheckArray.push(`${key}=${value}`);
    });
    dataCheckArray.sort();
    const dataCheckString = dataCheckArray.join('\n');

    // Compute secret key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(env.TELEGRAM_BOT_TOKEN)
      .digest();

    // Compute hash
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Verify hash
    if (computedHash !== hash) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Invalid Telegram init data',
      });
    }

    // Verify auth_date is not older than the configured session window.
    // Telegram Mini Apps can stay open for long periods, so a short TTL
    // causes valid in-app sessions to fail unexpectedly.
    const authDate = Number(params.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);

    if (!authDate || now - authDate > env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Telegram init data expired',
      });
    }

    // Parse user data
    const userJson = params.get('user');
    if (!userJson) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Missing user data',
      });
    }

    const userData = JSON.parse(userJson);

    return {
      id: userData.id.toString(),
      telegramId: userData.id.toString(),
      username: userData.username,
      strategy: AuthStrategy.TELEGRAM,
      metadata: {
        chatId: params.get('chat_id') || undefined,
        initData,
      },
    };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    throw new ORPCError('UNAUTHORIZED', {
      message: 'Failed to authenticate with Telegram',
    });
  }
}
