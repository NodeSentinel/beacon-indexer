/**
 * E2E test API token — must match API_TOKEN_SECRET env var.
 * Used to authenticate test requests against the securedProcedure middleware.
 */
export const E2E_API_TOKEN = process.env.API_TOKEN_SECRET!;

/**
 * Returns headers with Authorization for authenticated e2e test requests.
 * Merges with any additional headers provided.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${E2E_API_TOKEN}`,
    ...extra,
  };
}
