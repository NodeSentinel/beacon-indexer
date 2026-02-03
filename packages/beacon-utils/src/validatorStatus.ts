/**
 * Beacon API validator status strings.
 * @see https://docs.blockdaemon.com/docs/eth-validator-statuses
 */
export type ValidatorStatus =
  | 'pending_initialized'
  | 'pending_queued'
  | 'active_ongoing'
  | 'active_exiting'
  | 'active_slashed'
  | 'exited_unslashed'
  | 'exited_slashed'
  | 'withdrawal_possible'
  | 'withdrawal_done';

/** Numeric status codes for storage (1-based; current slot may be in progress). */
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
