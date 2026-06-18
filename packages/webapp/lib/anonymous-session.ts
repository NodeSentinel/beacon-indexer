'use client';

const SESSION_ID_KEY = 'beacon-monitor-session-id';

/**
 * Get or create a session UUID from localStorage.
 * This is sent as the `ns-anonymous-id` header for anonymous web users.
 * Returns null during SSR.
 */
export function getAnonymousSessionId(): string | null {
  if (typeof window === 'undefined') return null;

  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    if (typeof crypto.randomUUID === 'function') {
      sessionId = crypto.randomUUID();
    } else {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
}
