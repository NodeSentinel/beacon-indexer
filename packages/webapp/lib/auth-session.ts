'use client';

import { useSyncExternalStore } from 'react';

import { getAnonymousSessionId } from '@/lib/anonymous-session';

type AuthMode = 'telegram' | 'anonymous' | 'none';

interface AuthSnapshot {
  mode: AuthMode;
  cacheKey: string;
  telegramInitData: string | null;
  anonymousSessionId: string | null;
}

const listeners = new Set<() => void>();

let telegramInitData: string | null = null;

function notifyAuthChange() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Build the current auth snapshot used by the webapp client and query cache keys.
 */
export function getAuthSnapshot(): AuthSnapshot {
  if (typeof window === 'undefined') {
    return {
      mode: 'none',
      cacheKey: 'none',
      telegramInitData: null,
      anonymousSessionId: null,
    };
  }

  if (telegramInitData) {
    return {
      mode: 'telegram',
      cacheKey: `telegram:${telegramInitData}`,
      telegramInitData,
      anonymousSessionId: null,
    };
  }

  const anonymousSessionId = getAnonymousSessionId();
  if (anonymousSessionId) {
    return {
      mode: 'anonymous',
      cacheKey: `anonymous:${anonymousSessionId}`,
      telegramInitData: null,
      anonymousSessionId,
    };
  }

  return {
    mode: 'none',
    cacheKey: 'none',
    telegramInitData: null,
    anonymousSessionId: null,
  };
}

/**
 * Subscribe to auth changes so React Query keys can react when auth mode changes.
 */
export function subscribeAuthSnapshot(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Store Telegram initData for API auth header injection.
 */
export function setTelegramInitData(data: string) {
  if (telegramInitData === data) {
    return;
  }

  telegramInitData = data;
  notifyAuthChange();
}

/**
 * Clear Telegram initData when the Mini App auth context is not available anymore.
 */
export function clearTelegramInitData() {
  if (telegramInitData === null) {
    return;
  }

  telegramInitData = null;
  notifyAuthChange();
}

/**
 * Read the current Telegram initData without subscribing.
 */
export function getTelegramInitData(): string | null {
  return telegramInitData;
}

/**
 * React hook for components that need an auth-stable cache key.
 */
export function useAuthSnapshot(): AuthSnapshot {
  return useSyncExternalStore(subscribeAuthSnapshot, getAuthSnapshot, () => ({
    mode: 'none',
    cacheKey: 'none',
    telegramInitData: null,
    anonymousSessionId: null,
  }));
}
