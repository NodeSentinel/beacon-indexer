'use client';

import { useState, useEffect } from 'react';

import { orpcClient } from './orpc';

const SESSION_ID_KEY = 'beacon-monitor-session-id';
const USER_ID_KEY = 'beacon-monitor-user-id';

/**
 * Get or create a session ID (UUID) from localStorage
 */
function getSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
}

/**
 * Get cached user ID from localStorage
 */
function getCachedUserId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(USER_ID_KEY) || '';
}

/**
 * Register anonymous user with the API and cache the user ID
 */
async function registerAnonymousUser(sessionId: string): Promise<string> {
  const response = await orpcClient.user.anonymous({ sessionId });
  if (!response.success || !response.data) {
    throw new Error('Failed to register anonymous user');
  }
  const userId = response.data.id;
  localStorage.setItem(USER_ID_KEY, userId);
  return userId;
}

/**
 * Hook to get the user ID
 * - First checks localStorage for cached userId
 * - If not found, calls API to create anonymous user
 * - Returns the BigInt user ID as a string
 */
export function useUserId(): string {
  const [userId, setUserId] = useState('');

  useEffect(() => {
    async function initUserId() {
      try {
        // Check for cached user ID first
        const cached = getCachedUserId();
        if (cached) {
          setUserId(cached);
          return;
        }

        // Get or create session ID
        const sessionId = getSessionId();
        if (!sessionId) {
          return;
        }

        // Register with API
        const newUserId = await registerAnonymousUser(sessionId);
        setUserId(newUserId);
      } catch (error) {
        console.error('Failed to initialize user ID:', error);
      }
    }

    initUserId();
  }, []);

  return userId;
}

/**
 * For backwards compatibility - returns the session UUID
 * @deprecated Use useUserId() instead
 */
export function getUserId(): string {
  return getSessionId();
}
