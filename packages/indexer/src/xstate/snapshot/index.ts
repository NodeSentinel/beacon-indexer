import type { Chain } from '@beacon-indexer/beacon-utils';
import { createActor, ActorRefFrom } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { incidentsMachine } from '@/src/xstate/incidents/incidents.machine.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { snapshotMachine } from './snapshot.machine.js';

export const getSnapshotActor = (
  snapshotController: SnapshotController,
  incidentsActor: ActorRefFrom<typeof incidentsMachine>,
  slotDuration: number,
  slotsPerEpoch: number,
  chain: Chain,
  maxAttestationDelay: number,
  delaySlotsToHead: number,
  missedAttestationsForInactivity: number,
) => {
  const actor = createActor(snapshotMachine, {
    input: {
      snapshotController,
      incidentsActor,
      slotDuration,
      slotsPerEpoch,
      chain,
      maxAttestationDelay,
      delaySlotsToHead,
      missedAttestationsForInactivity,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('snapshot', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
