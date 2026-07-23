import { createListWithdrawalsRoute } from './list.js';

/**
 * Creates the withdrawals router.
 */
export function createWithdrawalsRouter(params: Parameters<typeof createListWithdrawalsRoute>[0]) {
  return {
    list: createListWithdrawalsRoute(params),
  };
}
