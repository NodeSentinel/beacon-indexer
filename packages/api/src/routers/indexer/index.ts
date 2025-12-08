import { getStatus } from './status.js';

export const indexerRouter = {
  status: {
    get: getStatus,
  },
};
