import { blocksRouter } from './blocks/index.js';
import { botRouter } from './bot/index.js';
import { chainRouter } from './chain.js';
import { clusterRouter } from './cluster/index.js';
import { healthRouter } from './health.js';
import { indexerRouter } from './indexer/index.js';
import { userRouter } from './user/index.js';
import { utilsRouter } from './utils.js';
import { validatorRouter } from './validator/index.js';

export const router = {
  blocks: blocksRouter,
  bot: botRouter,
  chain: chainRouter,
  cluster: clusterRouter,
  health: healthRouter,
  indexer: indexerRouter,
  user: userRouter,
  utils: utilsRouter,
  validator: validatorRouter,
};
