import { describe, expect, it, vi } from 'vitest';

import { ValidatorsController } from './validators.js';

// This suite verifies validator controller batching before data is persisted.
describe('ValidatorsController', () => {
  // This test covers mainnet-scale validator snapshots where up to one epoch of
  // pending deposits can create new validator records after the stored max
  // index. The controller should fetch the known range plus the protocol
  // pending-deposit lookahead while keeping requests under the provider limit.
  it('fetches validator state with a 16-validator lookahead in 100k batches', async () => {
    // This storage mock represents validators 0 through 500,000 as already
    // known locally, so the controller must request those validators plus 16
    // possible new validators from the next epoch.
    const validatorsStorage = {
      getMaxValidatorIndex: vi.fn().mockResolvedValue(500_000),
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

    // This assertion verifies every request stays below the provider POST body
    // limit while the final request contains only the 16-validator lookahead
    // plus the known max validator index.
    expect(requestedBatchSizes).toEqual([100_000, 100_000, 100_000, 100_000, 100_000, 17]);

    // This assertion verifies five Beacon API requests run together for the
    // first wave, leaving the small lookahead batch for the second wave.
    expect(maxActiveRequests).toBe(5);

    // This assertion verifies the epoch fetched flag remains tied to the single
    // final storage call instead of being marked per partial request.
    expect(validatorsStorage.saveValidatorsForEpoch).toHaveBeenCalledTimes(1);
    expect(validatorsStorage.saveValidatorsForEpoch).toHaveBeenCalledWith([], 3_858);
  });
});
