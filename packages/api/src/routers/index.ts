import { clusterRouter } from './cluster/index.js';
import { healthRouter } from './health.js';
import { indexerRouter } from './indexer/index.js';
import { utilsRouter } from './utils.js';
import { validatorRouter } from './validator/index.js';

export const router = {
  cluster: clusterRouter,
  health: healthRouter,
  indexer: indexerRouter,
  utils: utilsRouter,
  validator: validatorRouter,
};
