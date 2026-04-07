import { createActor } from 'xstate';

import { incidentTrackerMachine } from './incidentTracker.machine.js';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { incidentTrackerMachine } from './incidentTracker.machine.js';

export const getIncidentTrackerActor = (
  incidentTrackerController: IncidentTrackerController,
  slotController: SlotController,
  slotDuration: number,
  maxAttestationDelay: number,
) => {
  const actor = createActor(incidentTrackerMachine, {
    input: {
      incidentTrackerController,
      slotController,
      slotDuration,
      maxAttestationDelay,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('incidentTracker', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
