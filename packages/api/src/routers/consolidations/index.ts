import { createListConsolidationsRoute } from './list.js';

/**
 * Creates the consolidations router.
 */
export function createConsolidationsRouter(
  params: Parameters<typeof createListConsolidationsRoute>[0],
) {
  return {
    list: createListConsolidationsRoute(params),
  };
}
