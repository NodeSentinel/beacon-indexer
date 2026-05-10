import { createActor } from 'xstate';

import { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';

export { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

export const getValidatorActivityStatusActor = (
  validatorActivityStatusController: ValidatorActivityStatusController,
  maxAttestationDelay: number,
  inactiveMissedCount: number,
) => {
  // Create a dedicated actor that periodically refreshes the fast validator
  // activity snapshot using the latest fully indexed committee data.
  const actor = createActor(validatorActivityStatusMachine, {
    input: {
      validatorActivityStatusController,
      maxAttestationDelay,
      inactiveMissedCount,
    },
  });

  return actor;
};
