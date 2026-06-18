import { createIndexerStatusRoute } from './status.js';

/**
 * Creates the indexer router.
 */
export function createIndexerRouter(params: Parameters<typeof createIndexerStatusRoute>[0]) {
  return {
    status: createIndexerStatusRoute(params),
  };
}
