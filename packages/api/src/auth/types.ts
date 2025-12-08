/**
 * Supported authentication strategies
 */
export enum AuthStrategy {
  TOKEN = 'token',
  TELEGRAM = 'telegram',
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
 * Token-based authenticated user
 */
export interface TokenUser extends AuthenticatedUser {
  strategy: AuthStrategy.TOKEN;
  userId: string;
  metadata?: {
    scopes?: string[];
  };
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
export type User = TokenUser | TelegramUser;

/**
 * Auth context that will be added by auth middleware
 */
export interface AuthContext {
  user: User;
}
