import { healthRouter } from './health.js';
import { indexerRouter } from './indexer/index.js';
import { utilsRouter } from './utils.js';

export const router = {
  health: healthRouter,
  indexer: indexerRouter,
  utils: utilsRouter,
};
