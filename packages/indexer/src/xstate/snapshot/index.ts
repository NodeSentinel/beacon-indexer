import type { Chain } from '@beacon-indexer/beacon-utils';
import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';

export { snapshotMachine } from './snapshot.machine.js';

export const getSnapshotActor = (
  snapshotController: SnapshotController,
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
      slotDuration,
      slotsPerEpoch,
      chain,
      maxAttestationDelay,
      delaySlotsToHead,
      missedAttestationsForInactivity,
    },
  });

  return actor;
};
