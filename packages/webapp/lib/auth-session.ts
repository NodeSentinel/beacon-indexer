'use client';

import { getAnonymousSessionId } from '@/lib/anonymous-session';

type AuthMode = 'unset' | 'telegram' | 'anonymous';

interface AuthState {
  mode: AuthMode;
  telegramInitData: string | null;
  anonymousSessionId: string | null;
}

const authState: AuthState = {
  mode: 'unset',
  telegramInitData: null,
  anonymousSessionId: null,
};

/**
 * Lock the app into Telegram Mini App auth before rendering the rest of the UI.
 */
export function initializeTelegramAuth(initData: string) {
  authState.mode = 'telegram';
  authState.telegramInitData = initData;
  authState.anonymousSessionId = null;
}

/**
 * Lock the app into anonymous web auth before rendering the rest of the UI.
 */
export function initializeAnonymousAuth() {
  authState.mode = 'anonymous';
  authState.telegramInitData = null;
  authState.anonymousSessionId = getAnonymousSessionId();
}

/**
 * Return the auth headers for the mode chosen during app bootstrap.
 */
export function getAuthHeaders(): Record<string, string> {
  if (authState.mode === 'telegram' && authState.telegramInitData) {
    return { 'x-telegram-init-data': authState.telegramInitData };
  }

  if (authState.mode === 'anonymous' && authState.anonymousSessionId) {
    return { 'ns-anonymous-id': authState.anonymousSessionId };
  }

  return {};
}
