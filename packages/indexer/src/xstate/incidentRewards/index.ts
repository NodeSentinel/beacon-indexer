import { createActor } from 'xstate';

import { incidentRewardsMachine } from './incidentRewards.machine.js';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { incidentRewardsMachine } from './incidentRewards.machine.js';

export const getIncidentRewardsActor = (
  incidentRewardsController: IncidentRewardsController,
  slotController: SlotController,
) => {
  const actor = createActor(incidentRewardsMachine, {
    input: {
      incidentRewardsController,
      slotController,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('incidentRewards', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
