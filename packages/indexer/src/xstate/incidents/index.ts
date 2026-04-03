import { createActor } from 'xstate';

import { incidentsMachine } from './incidents.machine.js';

import { IncidentController } from '@/src/services/consensus/controllers/incident.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { incidentsMachine } from './incidents.machine.js';

export const getIncidentsActor = (
  incidentController: IncidentController,
  maxAttestationDelay: number,
) => {
  const actor = createActor(incidentsMachine, {
    input: {
      incidentController,
      maxAttestationDelay,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('incidents', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
