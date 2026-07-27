import { createBlocksRouter } from './blocks/index.js';
import { createBotRouter } from './bot/index.js';
import { createChainRouter } from './chain.js';
import { createClusterRouter } from './cluster/index.js';
import { createConsolidationsRouter } from './consolidations/index.js';
import { createDepositsRouter } from './deposits/index.js';
import { createHealthRouter } from './health.js';
import { createIndexerRouter } from './indexer/index.js';
import { createUserRouter } from './user/index.js';
import { createUtilsRouter } from './utils.js';
import { createValidatorRouter } from './validator/index.js';
import { createWithdrawalsRouter } from './withdrawals/index.js';
import type { ApiDependencies } from '@/dependencies.js';

export type Router = ReturnType<typeof createRouter>;
export declare const router: Router;

/**
 * Creates the top-level API router tree.
 */
export function createRouter(deps: ApiDependencies) {
  return {
    blocks: createBlocksRouter(deps),
    bot: createBotRouter(deps),
    chain: createChainRouter(deps),
    cluster: createClusterRouter(deps),
    consolidations: createConsolidationsRouter(deps),
    deposits: createDepositsRouter(deps),
    health: createHealthRouter(deps),
    indexer: createIndexerRouter(deps),
    user: createUserRouter(deps),
    utils: createUtilsRouter(deps),
    validator: createValidatorRouter(deps),
    withdrawals: createWithdrawalsRouter(deps),
  };
}
