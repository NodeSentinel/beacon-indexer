import { createListDepositsRoute } from './list.js';

/**
 * Creates the deposits router.
 */
export function createDepositsRouter(params: Parameters<typeof createListDepositsRoute>[0]) {
  return {
    list: createListDepositsRoute(params),
  };
}
