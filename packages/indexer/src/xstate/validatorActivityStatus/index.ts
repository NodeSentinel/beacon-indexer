import { createActor } from 'xstate';

import { validatorActivityStatusMachine } from './validatorActivityStatus.machine.js';

import { ValidatorActivityStatusController } from '@/src/services/consensus/controllers/validatorActivityStatus.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';
import { buildTraceDefinition } from '@/src/xstate/traceUtils.js';

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

  // Mirror the machine state into the shared multi-machine logger for debugging
  // and operational visibility.
  actor.subscribe((snapshot) => {
    // Trace the validator activity status machine with its current state only.
    logMachine('validatorActivityStatus', `State: ${JSON.stringify(snapshot.value)}`, undefined, {
      buildTrace: ({ context, machineId, parentMachineId, state, traceRootId }) =>
        buildTraceDefinition({
          machineGroup: 'other',
          machineName: 'validatorActivityStatus',
          machineId,
          state,
          context,
          traceRootId,
          parentMachineId,
          messagePrefix: 'validatorActivityStatus',
        }),
    });
  });

  return actor;
};
