import { chainRouter } from './chain.js';
import { clusterRouter } from './cluster/index.js';
import { healthRouter } from './health.js';
import { indexerRouter } from './indexer/index.js';
import { userRouter } from './user/index.js';
import { utilsRouter } from './utils.js';
import { validatorRouter } from './validator/index.js';

export const router = {
  chain: chainRouter,
  cluster: clusterRouter,
  health: healthRouter,
  indexer: indexerRouter,
  user: userRouter,
  utils: utilsRouter,
  validator: validatorRouter,
};
