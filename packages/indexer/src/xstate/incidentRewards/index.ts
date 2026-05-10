import { createActor } from 'xstate';

import { incidentRewardsMachine } from './incidentRewards.machine.js';

import { IncidentRewardsController } from '@/src/services/consensus/controllers/incidentRewards.js';

export { incidentRewardsMachine } from './incidentRewards.machine.js';

export const getIncidentRewardsActor = (incidentRewardsController: IncidentRewardsController) => {
  // Create a background actor that periodically advances missed rewards for open
  // and recently closed incidents.
  const actor = createActor(incidentRewardsMachine, {
    input: {
      incidentRewardsController,
    },
  });

  return actor;
};
