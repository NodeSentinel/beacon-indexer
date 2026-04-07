import { createActor } from 'xstate';

import { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

export const getValidatorActivityStatusActor = (
  validatorActivityStatusController: ValidatorActivityStatusController,
  slotController: SlotController,
  slotDuration: number,
  maxIndexerLagSlotsForAlerts: number,
  maxAttestationDelay: number,
) => {
  const actor = createActor(validatorActivityStatusMachine, {
    input: {
      validatorActivityStatusController,
      slotController,
      slotDuration,
      maxIndexerLagSlotsForAlerts,
      maxAttestationDelay,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('validatorActivityStatus', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
