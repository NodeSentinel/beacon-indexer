import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { snapshotMachine } from './snapshot.machine.js';

export const getSnapshotActor = (
  snapshotController: SnapshotController,
  slotDuration: number,
  slotsPerEpoch: number,
  maxAttestationDelay: number,
  delaySlotsToHead: number,
  missedAttestationsForInactivity: number,
) => {
  const actor = createActor(snapshotMachine, {
    input: {
      snapshotController,
      slotDuration,
      slotsPerEpoch,
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
