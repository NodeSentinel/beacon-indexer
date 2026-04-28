import { createActor } from 'xstate';

import { chainStatsMachine } from './chainStats.machine.js';

import { ChainStatsController } from '@/src/services/consensus/controllers/chainStats.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

export { chainStatsMachine } from './chainStats.machine.js';

export const getChainStatsActor = (chainStatsController: ChainStatsController) => {
  const actor = createActor(chainStatsMachine, {
    input: {
      chainStatsController,
    },
  });

  actor.subscribe((snapshot) => {
    // Trace the chain stats machine with its current state only.
    logMachine('chainStats', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'other',
          machineName: 'chainStats',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'chainStats',
        }),
    });
  });

  return actor;
};
