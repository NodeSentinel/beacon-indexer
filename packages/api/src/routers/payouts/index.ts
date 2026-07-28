import { createListPayoutsRoute } from './list.js';

/**
 * Creates the payouts procedure exposed directly at the top-level RPC path.
 */
export function createPayoutsRouter(params: Parameters<typeof createListPayoutsRoute>[0]) {
  return createListPayoutsRoute(params);
}
