'use client';

import { useState, useEffect } from 'react';

import { useAuthSnapshot } from './auth-session';
import { orpcClient } from './orpc';

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
  const [userId, setUserId] = useState('');
  const auth = useAuthSnapshot();

  useEffect(() => {
    async function fetchUserId() {
      try {
        const response = await orpcClient.user.me();
        if (response.success && response.data) {
          setUserId(response.data.id);
          return;
        }

        setUserId('');
      } catch (error) {
        console.error('Failed to fetch user ID:', error);
        setUserId('');
      }
    }

    fetchUserId();
  }, [auth.cacheKey]);

  return userId;
}
