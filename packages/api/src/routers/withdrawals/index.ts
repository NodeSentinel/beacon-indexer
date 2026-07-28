import { createListWithdrawalsRoute } from './list.js';

/**
 * Creates the withdrawals procedure exposed directly at the top-level RPC path.
 */
export function createWithdrawalsRouter(params: Parameters<typeof createListWithdrawalsRoute>[0]) {
  return createListWithdrawalsRoute(params);
}
