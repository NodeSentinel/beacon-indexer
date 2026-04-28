import { createActor } from 'xstate';

import { incidentRewardsMachine } from './incidentRewards.machine.js';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

export { incidentRewardsMachine } from './incidentRewards.machine.js';

export const getIncidentRewardsActor = (incidentRewardsController: IncidentRewardsController) => {
  // Create a background actor that periodically advances missed rewards for open
  // and recently closed incidents.
  const actor = createActor(incidentRewardsMachine, {
    input: {
      incidentRewardsController,
    },
  });

  // Emit machine state transitions to the shared logger so reward sync cadence
  // and failures are visible in the same stream as the other workers.
  actor.subscribe((snapshot) => {
    // Trace the incident rewards machine with its current state only.
    logMachine('incidentRewards', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'other',
          machineName: 'incidentRewards',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'incidentRewards',
        }),
    });
  });

  return actor;
};
