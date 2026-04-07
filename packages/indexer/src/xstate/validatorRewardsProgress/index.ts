import { createActor } from 'xstate';

import { validatorRewardsProgressMachine } from './validatorRewardsProgress.machine.js';

import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { ValidatorRewardsProgressController } from '@/src/services/consensus/controllers/validatorRewardsProgress.js';
import { logMachine } from '@/src/xstate/multiMachineLogger.js';

export { validatorRewardsProgressMachine } from './validatorRewardsProgress.machine.js';

export const getValidatorRewardsProgressActor = (
  validatorRewardsProgressController: ValidatorRewardsProgressController,
  slotController: SlotController,
) => {
  const actor = createActor(validatorRewardsProgressMachine, {
    input: {
      validatorRewardsProgressController,
      slotController,
    },
  });

  actor.subscribe((snapshot) => {
    logMachine('validatorRewardsProgress', `State: ${JSON.stringify(snapshot.value)}`);
  });

  return actor;
};
