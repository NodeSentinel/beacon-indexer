import type { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { createActor } from 'xstate';

import { lagAlertingMachine } from './lagAlerting.machine.js';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';

export { lagAlertingMachine } from './lagAlerting.machine.js';

export const getLagAlertingActor = (
  slotController: SlotController,
  beaconTime: BeaconTime,
  chain: string,
) => {
  const actor = createActor(lagAlertingMachine, {
    input: {
      slotController,
      beaconTime,
      chain,
    },
  });

  return actor;
};
