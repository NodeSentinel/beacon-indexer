import type { Chain } from '@beacon-indexer/beacon-utils';
import { createActor } from 'xstate';

import { snapshotMachine } from './snapshot.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

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

  actor.subscribe((snapshot) => {
    // Trace the snapshot machine with its current state only.
    logMachine('snapshot', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'snapshot',
          machineName: 'snapshot',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'snapshot',
        }),
    });
  });

  return actor;
};
