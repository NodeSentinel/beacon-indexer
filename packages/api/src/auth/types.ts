/**
 * Supported authentication strategies
 */
export enum AuthStrategy {
  TELEGRAM = 'telegram',
  BOT_SIGNATURE = 'bot_signature',
}

/**
 * Base authenticated user interface
 */
export interface AuthenticatedUser {
  id: string;
  strategy: AuthStrategy;
  metadata?: Record<string, unknown>;
}

/**
 * Telegram mini-app authenticated user
 */
export interface TelegramUser extends AuthenticatedUser {
  strategy: AuthStrategy.TELEGRAM;
  telegramId: string;
  username?: string;
  metadata?: {
    chatId?: string;
    initData?: string;
  };
}

/**
 * Union type of all possible authenticated users
 */
export type User = TelegramUser;

/**
 * Auth context that will be added by auth middleware
 */
export interface AuthContext {
  user: User;
}
