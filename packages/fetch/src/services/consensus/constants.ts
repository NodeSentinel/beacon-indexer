// 1 because the current slot might be in progress

import { ValidatorStatus } from '@/src/services/consensus/types.js';

export const VALIDATOR_STATUS = {
  pending_initialized: 0,
  pending_queued: 1,
  active_ongoing: 2,
  active_exiting: 3,
  active_slashed: 4,
  exited_unslashed: 5,
  exited_slashed: 6,
  withdrawal_possible: 7,
  withdrawal_done: 8,
} as const satisfies Record<ValidatorStatus, number>;
