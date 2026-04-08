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
  // Create a background actor that periodically advances missed rewards for open
  // and recently closed incidents.
  const actor = createActor(incidentRewardsMachine, {
    input: {
      incidentRewardsController,
      slotController,
    },
  });

  // Emit machine state transitions to the shared logger so reward sync cadence
  // and failures are visible in the same stream as the other workers.
  actor.subscribe((snapshot) => {
    logMachine('incidentRewards', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
