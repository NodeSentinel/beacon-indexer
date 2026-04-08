import { createActor } from 'xstate';

import { incidentTrackerMachine } from './incidentTracker.machine.js';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { incidentTrackerMachine } from './incidentTracker.machine.js';

export const getIncidentTrackerActor = (
  incidentTrackerController: IncidentTrackerController,
  slotDuration: number,
  maxAttestationDelay: number,
  inactiveMissedCount: number,
) => {
  // Create a dedicated actor that replays newly safe slots into the durable
  // cluster-incident state machine.
  const actor = createActor(incidentTrackerMachine, {
    input: {
      incidentTrackerController,
      slotDuration,
      maxAttestationDelay,
      inactiveMissedCount,
    },
  });

  // Emit state transitions to the shared machine logger so incident processing is
  // easy to follow alongside the other long-running actors.
  actor.subscribe((snapshot) => {
    logMachine('incidentTracker', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
