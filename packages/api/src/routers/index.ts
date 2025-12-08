import { healthRouter } from './health.js';
import { indexerRouter } from './indexer/index.js';

export const router = {
  health: healthRouter,
  indexer: indexerRouter,
};
