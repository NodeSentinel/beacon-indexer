import crypto from 'node:crypto';

import { ORPCError } from '@orpc/server';

import { AuthStrategy, type TelegramUser } from '../types.js';

export interface TelegramAuthenticator {
  authenticateTelegram: (initData: string) => Promise<TelegramUser>;
}

/**
 * Creates the Telegram Mini App authentication strategy.
 */
export function createTelegramAuthenticator(config: {
  maxAgeSeconds: number;
  telegramBotToken: string;
}): TelegramAuthenticator {
  /**
   * Authenticates Telegram Mini App init data.
   */
  async function authenticateTelegram(initData: string): Promise<TelegramUser> {
    try {
      const searchParams = new URLSearchParams(initData);
      const hash = searchParams.get('hash');
      searchParams.delete('hash');

      if (!hash) {
        throw new ORPCError('UNAUTHORIZED', {
          message: 'Missing hash in init data',
        });
      }

      const dataCheckArray: string[] = [];
      searchParams.forEach((value, key) => {
        dataCheckArray.push(`${key}=${value}`);
      });
      dataCheckArray.sort();
      const dataCheckString = dataCheckArray.join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(config.telegramBotToken)
        .digest();

      const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      if (computedHash !== hash) {
        throw new ORPCError('UNAUTHORIZED', {
          message: 'Invalid Telegram init data',
        });
      }

      const authDate = Number(searchParams.get('auth_date'));
      const now = Math.floor(Date.now() / 1000);

      if (!authDate || now - authDate > config.maxAgeSeconds) {
        throw new ORPCError('UNAUTHORIZED', {
          message: 'Telegram init data expired',
        });
      }

      const userJson = searchParams.get('user');
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
          chatId: searchParams.get('chat_id') || undefined,
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

  return {
    authenticateTelegram,
  };
}
