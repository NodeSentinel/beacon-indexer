import { createListPayoutsRoute } from './list.js';

/**
 * Creates the payouts router.
 */
export function createPayoutsRouter(params: Parameters<typeof createListPayoutsRoute>[0]) {
  return {
    list: createListPayoutsRoute(params),
  };
}
