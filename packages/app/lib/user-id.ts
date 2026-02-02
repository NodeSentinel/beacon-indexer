'use client';

import { useState, useEffect } from 'react';

const USER_ID_KEY = 'beacon-monitor-user-id';

/**
 * Get or create a persistent user ID from localStorage
 */
export function getUserId(): string {
  if (typeof window === 'undefined') return '';

  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

/**
 * Hook to get the user ID (handles SSR)
 */
export function useUserId(): string {
  const [userId, setUserId] = useState('');

  useEffect(() => {
    setUserId(getUserId());
  }, []);

  return userId;
}
