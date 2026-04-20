import type { Chain } from '@beacon-indexer/beacon-utils';
import { createActor } from 'xstate';

import { activityMachine } from './activity.machine.js';
import { balancesPerformanceMachine } from './balancesPerformance.machine.js';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { activityMachine } from './activity.machine.js';
export { balancesPerformanceMachine } from './balancesPerformance.machine.js';

export const getActivityActor = (
  validatorActivityStatusController: ValidatorActivityStatusController,
  slotDuration: number,
  skipValidatorStatusUpdateWhenBehindHeadSlots: number,
  maxAttestationDelay: number,
  inactiveMissedCount: number,
) => {
  // Create a dedicated actor that periodically refreshes the fast validator
  // activity snapshot using the latest fully indexed committee data.
  const actor = createActor(activityMachine, {
    input: {
      validatorActivityStatusController,
      slotDuration,
      skipValidatorStatusUpdateWhenBehindHeadSlots,
      maxAttestationDelay,
      inactiveMissedCount,
    },
  });

  // Mirror the machine state into the shared multi-machine logger for debugging
  // and operational visibility.
  actor.subscribe((snapshot) => {
    logMachine('validatorActivityStatus', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};

export const getBalancesPerformanceActor = (
  snapshotController: SnapshotController,
  slotDuration: number,
  slotsPerEpoch: number,
  chain: Chain,
  maxAttestationDelay: number,
  delaySlotsToHead: number,
  missedAttestationsForInactivity: number,
) => {
  const actor = createActor(balancesPerformanceMachine, {
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
    logMachine('snapshot', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
