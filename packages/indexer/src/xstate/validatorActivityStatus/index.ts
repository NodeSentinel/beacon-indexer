import { createActor } from 'xstate';

import { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

export const getValidatorActivityStatusActor = (
  validatorActivityStatusController: ValidatorActivityStatusController,
  slotDuration: number,
  skipValidatorStatusUpdateWhenBehindHeadSlots: number,
  maxAttestationDelay: number,
  inactiveMissedCount: number,
) => {
  // Create a dedicated actor that periodically refreshes the fast validator
  // activity snapshot using the latest fully indexed committee data.
  const actor = createActor(validatorActivityStatusMachine, {
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
