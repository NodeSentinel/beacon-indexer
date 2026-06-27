import type { Chain } from '@beacon-indexer/beacon-utils';
import type { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import type { ClaimableWithdrawalsController } from '@/src/services/consensus/controllers/claimableWithdrawals.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';

export { snapshotMachine } from './snapshot.machine.js';

// Builds the snapshot actor with indexer progress dependencies used by lag guards.
export const getSnapshotActor = (
  snapshotController: SnapshotController,
  slotController: SlotController,
  beaconTime: BeaconTime,
  slotDuration: number,
  slotsPerEpoch: number,
  chain: Chain,
  maxAttestationDelay: number,
  delaySlotsToHead: number,
  missedAttestationsForInactivity: number,
  claimableWithdrawalsController?: ClaimableWithdrawalsController,
) => {
  const actor = createActor(snapshotMachine, {
    input: {
      snapshotController,
      slotController,
      beaconTime,
      slotDuration,
      slotsPerEpoch,
      chain,
      claimableWithdrawalsController,
      maxAttestationDelay,
      delaySlotsToHead,
      missedAttestationsForInactivity,
    },
  });

  return actor;
};
