import { createListBlockProposalsRoute } from './list.js';

/**
 * Creates the blocks router.
 */
export function createBlocksRouter(params: Parameters<typeof createListBlockProposalsRoute>[0]) {
  return {
    list: createListBlockProposalsRoute(params),
  };
}
