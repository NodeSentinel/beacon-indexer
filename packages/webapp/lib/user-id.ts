'use client';

import { useCurrentUser } from '@/hooks/use-current-user';

/**
 * Hook to get the current user ID.
 *
 * Works for both Telegram and anonymous web users — calls user.me which
 * returns the DB user resolved by the API middleware (from either
 * x-telegram-init-data or ns-anonymous-id header).
 *
 * Returns the DB user ID as a string, or empty string while loading.
 */
export function useUserId(): string {
  const { data: user } = useCurrentUser();
  return user?.id ?? '';
}
