import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PENDING_DEPOSITS_PER_EPOCH,
  VALIDATOR_STATE_FETCH_BATCH_SIZE,
  VALIDATOR_STATE_FETCH_CONCURRENCY,
  ValidatorsController,
} from './validators.js';

// This suite verifies validator controller batching before data is persisted.
describe('ValidatorsController', () => {
  // This test covers validator snapshots that cross one full fetch batch. The
  // controller should fetch complete batches first, then include the
  // pending-deposit lookahead in the final partial batch.
  it('fetches validator state with the pending-deposit lookahead after full batches', async () => {
    // This value creates exactly one full batch plus one final partial batch
    // containing the known max validator and every possible new validator from
    // one epoch of pending deposits.
    const maxValidatorIndex = VALIDATOR_STATE_FETCH_BATCH_SIZE;

    // This storage mock represents a local validator table whose max index
    // lands just after a full batch boundary.
    const validatorsStorage = {
      getMaxValidatorIndex: vi.fn().mockResolvedValue(maxValidatorIndex),
      getFinalValidatorIndexes: vi.fn().mockResolvedValue([]),
      saveValidatorsForEpoch: vi.fn().mockResolvedValue(undefined),
    };

    // These counters capture how many Beacon API requests are in flight at the
    // same time, proving the controller batches concurrently rather than
    // awaiting each request before starting the next.
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestedBatchSizes: number[] = [];

    // This Beacon client mock delays each request long enough for concurrent
    // calls in the same group to overlap while returning no rows to keep the
    // test focused on request scheduling instead of validator data shape.
    const beaconClient = {
      getValidators: vi.fn(async (_slot: number, validatorIndexes: string[]) => {
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        requestedBatchSizes.push(validatorIndexes.length);

        await new Promise((resolve) => setTimeout(resolve, 5));

        activeRequests--;
        return [];
      }),
    };

    // This controller only needs Beacon client fetches and validator storage for
    // epoch validator state snapshots.
    const controller = new ValidatorsController(
      beaconClient as never,
      validatorsStorage as never,
      {} as never,
    );

    // This action fetches one epoch snapshot from the supplied slot.
    await controller.fetchValidatorsState(123_456, 3_858);

    // This assertion verifies the controller uses the configured batch size and
    // leaves only the pending-deposit lookahead plus max validator for the
    // second request.
    expect(requestedBatchSizes).toEqual([
      VALIDATOR_STATE_FETCH_BATCH_SIZE,
      MAX_PENDING_DEPOSITS_PER_EPOCH + 1,
    ]);

    // This assertion verifies the controller honors the configured concurrency
    // without depending on the specific numeric value chosen for production.
    expect(maxActiveRequests).toBe(VALIDATOR_STATE_FETCH_CONCURRENCY);

    // This assertion verifies the epoch fetched flag remains tied to the single
    // final storage call instead of being marked per partial request.
    expect(validatorsStorage.saveValidatorsForEpoch).toHaveBeenCalledTimes(1);
    expect(validatorsStorage.saveValidatorsForEpoch).toHaveBeenCalledWith([], 3_858);
  });
});
