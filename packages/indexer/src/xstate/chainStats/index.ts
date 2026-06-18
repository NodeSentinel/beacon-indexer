import { createActor } from 'xstate';

import { chainStatsMachine } from './chainStats.machine.js';

import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';

export { chainStatsMachine } from './chainStats.machine.js';

export const getChainStatsActor = (chainStatsController: ChainStatsController) => {
  const actor = createActor(chainStatsMachine, {
    input: {
      chainStatsController,
    },
  });

  return actor;
};
