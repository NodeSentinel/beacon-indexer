import type { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { createActor } from 'xstate';

import { lagAlertingMachine } from './lagAlerting.machine.js';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';

import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

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

  actor.subscribe((snapshot) => {
    // Trace the lag alerting machine with its current state only.
    logMachine('lagAlerting', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'other',
          machineName: 'lagAlerting',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'lagAlerting',
        }),
    });
  });

  return actor;
};
